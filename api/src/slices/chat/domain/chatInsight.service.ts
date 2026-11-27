import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ILlmGateway, anthropicAuthHeaders } from '#/llm/domain';
import type { ILlmCredentialData } from '#/llm/domain';
import { TranscriptReaderService } from '#/agent/file/domain';
import { AgentPermissionService } from '#/agent/agent/domain/agentPermission.service';
import { IChatGateway } from './chat.gateway';
import { IChatTopicGateway } from './chatTopic.gateway';
import {
  ChatOutcomeTypes,
  IChatInsightBatchResult,
  IChatInsightExclusion,
  IChatInsightGate,
  IChatSessionData,
  IChatTopicData,
} from './chat.types';
import {
  IInsightAsk,
  IOfferedTopic,
  IProposedTopic,
  ParsedInsight,
  UnusableAnswerReason,
  VOCABULARY_CAP,
  buildInsightPrompt,
  parseInsights,
  transcriptText,
  unusableAnswerReason,
} from './chatInsight.prompt';
import { TOPICS_STANDING_MAX, topicLabel } from './chatTopic';
import { captureBackgroundError } from '#/setup/sentry';

const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-4-6';

/**
 * How far back a summary written by an older prompt is redone (CLEAN-270,
 * spec 038 research R7): the conversation's last message is within 180
 * days. That is the longest period the statistics page shows, 90 days, and
 * the one before it, which it compares with; the settle pass reaches as far
 * for the same reason (docs/statistics.md). An older conversation is on no
 * page that reads the new fields, so redoing its summary would be model
 * spend that nobody sees.
 */
const RESUMMARIZE_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;

/** The labels `insights.topics` is written in: what the admin console reads. */
const INSIGHTS_LANGUAGE = 'en';

/**
 * The fewest messages from the person a conversation is summarised with.
 * Under three there is a greeting or a single question, and nothing a
 * summary could say that the conversation's first line does not. Exported
 * for the statistics page (CLEAN-270), which tells a conversation that is
 * waiting for its summary from one that will not get one: both must mean
 * the same three.
 */
export const INSIGHT_MIN_USER_MESSAGES = 3;

/**
 * The most tokens the model may spend on one summary: `max_tokens` of the
 * call (CLEAN-270).
 *
 * The answer itself is a JSON object of a few hundred tokens. The number is
 * not sized for the answer alone, because the model is whichever one the
 * installation's credential names, and one that thinks unless told
 * otherwise (`claude-haiku-5-5`, production's) spends its thinking from this
 * same number. At 1 024, which it was, the thinking used the limit up: the
 * answer stopped with `stop_reason: "max_tokens"` after a `thinking` block,
 * before or in the middle of its JSON, and nothing was stored for any
 * conversation on any run. 4 096 leaves room for the thinking and the
 * answer both, and an answer of that length still arrives well inside the
 * HTTP timeout of a call that is not streamed.
 *
 * The request deliberately sets nothing else: no `thinking`, no
 * `output_config.effort`, no `temperature`, `top_p` or `top_k`. It would be
 * cheaper with less thinking, and it would be a 400 on half the models a
 * credential can name: an older one (`claude-haiku-4-5` is in use) rejects
 * `effort`, and the newer ones reject the sampling parameters and most
 * settings of `thinking`. A 400 sets every conversation aside
 * (`lastsBeyondARetry`). Whoever narrows this to one model can tune it for
 * that model; until then the limit is the one setting every model takes.
 */
export const INSIGHT_MAX_TOKENS = 4096;

/**
 * How long a conversation has to be quiet before it is summarised, and how
 * long one whose transcript could not be read waits before the batch tries
 * it again: an hour both times, the patience the settle pass has
 * (`ChatActivityService`).
 */
const COOLDOWN_MS = 60 * 60 * 1000;

/**
 * How long a conversation waits after the model's answer about it could not
 * be used, the first time (CLEAN-270, review): the batch's own cooldown, an
 * hour. It is the wait a conversation has before its first summary and the
 * wait after a transcript that could not be read; a shorter one would only
 * be the old behaviour at a lower rate. Each failure after that doubles it:
 * 1, 2, 4, 8, 16 hours.
 */
const UNUSABLE_BACKOFF_START_MS = COOLDOWN_MS;

/**
 * The longest such wait: a day. An answer that is unusable five times in a
 * row is unusable because of what the conversation says, and that does not
 * change by waiting; what can change is the model behind the credential or
 * the prompt, and neither changes more often than a day. One call a day per
 * such conversation is what it costs to notice: 25 of them written on
 * purpose are 25 calls a day, where they were 25 on every run (2 400 a day
 * at a run every quarter of an hour) and the whole of every run.
 */
const UNUSABLE_BACKOFF_MAX_MS = 24 * 60 * 60 * 1000;

/**
 * How many rows a run reads only to skip them (CLEAN-270, review): 25, as
 * many as it summarises (`gate.limit`), so a run reads at most twice what
 * it works on. A conversation set aside is still eligible as far as the
 * database knows, and reading it is how the run learns that it has left
 * (summarised by hand, no longer eligible) or moved; but each is a whole
 * `ChatSession` row, and the query used to grow by one for every entry ever
 * made. Past this number the rest are named to the query instead
 * (`gate.exclude`), which reads nothing for them.
 */
const SET_ASIDE_READ_MAX = 25;

/**
 * How many conversations are kept set aside at once: a thousand. One named
 * to the query is two bound values (its id and its last message), so the
 * statement carries under 2 000 of the 32 767 Postgres allows, and the map
 * a few hundred kilobytes. A thousand is forty runs in a row that could
 * summarise nothing they took: an installation with more than that among
 * its newest conversations needs the column this map stands in for (see
 * `setAside`). Past the number the oldest entry is forgotten, which costs
 * what a restart costs: one more read, or one more call, for it.
 */
const SET_ASIDE_MAX = 1000;

/**
 * The provider statuses that say "later" and nothing about the request: a
 * timeout and a rate limit. With the 5xx they are failures a conversation
 * is not set aside for; any other 4xx is the provider refusing this request
 * for what is in it, and it would refuse it again.
 */
const PROVIDER_RETRY_STATUSES: readonly number[] = [408, 429];

/** What became of one conversation handed to `summarizeSession`. */
type Attempt =
  /** A summary was written. */
  | 'summarized'
  /** No transcript, or no message in it: there is nothing to summarise. */
  | 'nothing'
  /** The transcript is there, as far as anybody knows, and the read failed. */
  | 'unreadable';

/** A conversation the batch leaves alone for now (`setAside` below). */
interface ISetAside {
  /** The conversation's last message when it was set aside, in ms. */
  lastMessageAt: number;
  /** Tried again from this moment on; `Infinity` for "not by the clock". */
  until: number;
  /**
   * How many times in a row the model's answer about it could not be used;
   * 0 for a conversation set aside for its transcript. It is what the next
   * wait is doubled from, so it outlives `until`: an entry whose time is
   * over stays until the run that tries it again has its answer.
   */
  failures: number;
}

/**
 * What one piece of work keeps while it goes through its conversations: a
 * run of the batch, or one summary asked for by hand. Each is read on first
 * need and once; a read that failed is not kept, so the next conversation
 * asks again.
 */
interface IRun {
  /** Conversations by standing topic id, kept up to date by the run. */
  tally: () => Promise<Map<string, number>>;
  /**
   * The agents only the Owner manages: a conversation with one of them
   * takes no topic.
   */
  ownerOnly: () => Promise<ReadonlySet<string>>;
  /**
   * Topics the rest of the run is offered whatever their count: the ones it
   * coined, and the ones it found outside the list when a conversation
   * proposed their key. By count alone such a topic stands past the sixty
   * that are listed, and the next conversation on its subject would word
   * the subject anew.
   */
  always: Set<string>;
}

/** Read on first need, once; a failed read is forgotten and asked again. */
function once<T>(read: () => Promise<T>): () => Promise<T> {
  let kept: Promise<T> | undefined;
  return () =>
    (kept ??= read().catch((err) => {
      kept = undefined;
      throw err;
    }));
}

/** Add `by` under `id`; a topic no conversation carries any more is dropped. */
function count(tally: Map<string, number>, id: string, by: number): void {
  const next = (tally.get(id) ?? 0) + by;
  if (next > 0) tally.set(id, next);
  else tally.delete(id);
}

/** The interval of the batch in seconds, 0 when it is not set to a positive number. */
function batchIntervalSec(): number {
  const sec = Number(process.env.CHAT_INSIGHT_INTERVAL_SEC ?? 0);
  return Number.isFinite(sec) && sec > 0 ? sec : 0;
}

/**
 * One state of one credential: it changes when the credential is saved
 * again, with another key or not. Not the key itself, which has no business
 * being kept anywhere it is not needed.
 */
const stampOf = (credential: ILlmCredentialData) =>
  `${credential.id}:${credential.updatedAt?.getTime() ?? 0}`;

/**
 * The model answered, and nothing can be stored from the answer.
 *
 * The message says what was wrong and how long the answer was, and nothing
 * of what was in it (CLEAN-270, review). It used to quote the first 200
 * characters. The answer is the model writing about a conversation, the
 * person's own words possibly among them, and this message goes to the warn
 * log of the batch and into the 500 of `POST /chats/:id/summarize`.
 */
export class UnusableInsightAnswerError extends Error {
  constructor(
    readonly reason: UnusableAnswerReason,
    /** The length of the answer, in characters. */
    readonly answerLength: number,
  ) {
    super(
      `insight generator returned an unusable answer: ${reason} (answer of ${answerLength} characters)`,
    );
    this.name = 'UnusableInsightAnswerError';
  }
}

/** What the provider sent back for one call: the text, and how it ended. */
interface IModelAnswer {
  /** The `text` blocks joined; a `thinking` block before them is left out. */
  text: string;
  /** `stop_reason` as received; null when the answer carried none. */
  stopReason: string | null;
}

/**
 * What is wrong with an answer by how the provider says it ended, or null
 * for one that is read for what it says (CLEAN-270):
 *
 *  - `max_tokens`: the answer ran into `INSIGHT_MAX_TOKENS` and was cut.
 *  - `refusal`: the model, or a classifier in front of it, declined. The
 *    status is 200 all the same, and the text is empty or a beginning.
 *
 * Anything else is an answer that ended by itself (`end_turn`, a
 * `stop_sequence`) or one that does not say (no `stop_reason`), and the
 * parser decides, as it always did.
 */
function endedUnusable(stopReason: string | null): UnusableAnswerReason | null {
  if (stopReason === 'max_tokens') return 'cut at the token limit';
  if (stopReason === 'refusal') return 'declined by the model';
  return null;
}

/**
 * The provider answered with a status that is not a success and not a
 * rejected credential. A `BadGatewayException`, as it always was, for the
 * route and the tool that turn it into words; with the status, which says
 * whether the conversation is to blame (`lastsBeyondARetry`).
 */
class ProviderStatusError extends BadGatewayException {
  constructor(
    /** What the provider answered with; the exception itself is a 502. */
    readonly providerStatus: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Whether asking again on the next run would fail the same way: the answer
 * could not be used, or the provider refused the request for what is in it.
 *
 * Not a rejected credential (401, 403), which is every conversation's
 * failure alike and ends the run. Not a 5xx, a 408 or a 429, and not a
 * request that never got an answer: the provider being down or busy says
 * nothing about the conversation, and setting conversations aside for it
 * would have an outage cost each of them an hour and more after it ended.
 * Nor a failure of our own database. Those are asked again on the next run,
 * as before.
 */
function lastsBeyondARetry(err: unknown): boolean {
  if (err instanceof UnusableInsightAnswerError) return true;
  return (
    err instanceof ProviderStatusError &&
    err.providerStatus >= 400 &&
    err.providerStatus < 500 &&
    !PROVIDER_RETRY_STATUSES.includes(err.providerStatus)
  );
}

/**
 * Generates an LLM summary + structured insights per chat and stores them on
 * the ChatSession. Runs on demand (`POST /chats/:id/summarize`) and, if
 * `CHAT_INSIGHT_INTERVAL_SEC` is set, as a gated cron-batch (never summarizes
 * empty or unchanged chats — see IChatInsightGate). Same setInterval pattern as
 * ChatSyncService (ranch has no scheduler facility).
 *
 * Since version 2 (CLEAN-270) a summary also carries the person's main
 * question, how the conversation ended, and topics chosen from the
 * installation's vocabulary. The prompt and the parser are
 * `chatInsight.prompt.ts`; this class makes the call and stores the answer.
 */
@Injectable()
export class ChatInsightService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatInsightService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  /**
   * The credential the provider last refused (401 or 403), as `stampOf` it;
   * null once a call has gone through. Kept in memory: the API is one
   * process, and after a restart the next run finds out again.
   */
  private rejected: string | null = null;

  /**
   * Conversations the batch could make no summary of, by id (CLEAN-270).
   *
   * Such a conversation stays eligible as far as the database knows:
   * nothing was written for it, and nothing should be, because a time of
   * summary without a summary would have every page count it as summarised.
   * The batch takes the newest 25, archived ones included, so without this
   * the same ones came back on every run and a handful of them among the
   * newest were the whole run, for good.
   *
   * Three cases, kept apart because they end differently:
   *
   *  - nothing to read (no transcript, or no message in it): the next run
   *    would find the same nothing. Set aside until something new is said
   *    in it, which is when its last message moves.
   *  - the read failed (storage not answering, a transcript over the
   *    reader's size limit): the conversation may be whole. Set aside for
   *    `COOLDOWN_MS` and tried again, so an outage costs the newest
   *    conversations an hour and not their summary, and a transcript that
   *    never reads costs one read an hour and not a place in every run.
   *  - the model's answer could not be used, or the provider refused the
   *    request for what is in it (`lastsBeyondARetry`; review of
   *    CLEAN-270). What a conversation says can bring that about: an answer
   *    cut at the token limit or declined by the model (`endedUnusable`), a
   *    transcript that tells the model to answer something else. It was asked about again on every run, one model
   *    call each time, and 25 of them written on purpose were every place
   *    of every run. Set aside for an hour, then twice as long each time it
   *    fails again, at most a day (`UNUSABLE_BACKOFF_START_MS`,
   *    `UNUSABLE_BACKOFF_MAX_MS`).
   *
   * In every case the conversation is tried again at once when something
   * new is said in it: it is another text then, and what failed before says
   * nothing about it, so the count of failures starts over too.
   *
   * What the entries cost is bounded (`planRun`): a run reads at most
   * `SET_ASIDE_READ_MAX` rows in order to skip them and names the rest to
   * the query; an entry is forgotten when a run that could have found its
   * conversation did not, and at most `SET_ASIDE_MAX` are kept.
   *
   * In memory, as the settle pass keeps its own (`ChatActivityService`):
   * the API is one process, and a restart forgets it, after which each such
   * conversation costs one more read, or one more model call, and starts
   * its wait at an hour again. A column would outlive the restart; it is
   * not worth a migration until an installation shows that many of them.
   *
   * The Map keeps the order entries were made or last read in, oldest
   * first: that order is whose turn it is to be read, and who is forgotten
   * first.
   */
  private readonly setAside = new Map<string, ISetAside>();

  private readonly gate: IChatInsightGate = {
    cooldownMs: COOLDOWN_MS, // 1h settled
    minUserMessages: INSIGHT_MIN_USER_MESSAGES,
    limit: 25, // per-run cap bounds token spend
    resummarizeWindowMs: RESUMMARIZE_WINDOW_MS,
  };

  constructor(
    private readonly chats: IChatGateway,
    private readonly reader: TranscriptReaderService,
    private readonly llms: ILlmGateway,
    private readonly topics: IChatTopicGateway,
    // Which agents are the Owner's alone is the agent slice's to say, and
    // this is the class that says it for the chat routes and tools too
    // (`supervised`). The batch has no caller, so it asks the question
    // that needs none (`ownerOnlyAgentIds`).
    private readonly permission: AgentPermissionService,
  ) {}

  onModuleInit(): void {
    const sec = batchIntervalSec();
    if (!sec) return;
    this.logger.log(`chat insight batch enabled: every ${sec}s`);
    this.timer = setInterval(() => {
      void this.runBatch().catch((err) => {
        this.logger.error(`insight batch failed: ${(err as Error).message}`);
        captureBackgroundError(err, 'chat.insight');
      });
    }, sec * 1000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * Whether this installation produces summaries (CLEAN-270, spec 038
   * FR-011): the batch is scheduled in this process, there is an active
   * Anthropic credential, and the provider did not refuse that credential
   * the last time it was used.
   *
   * It is what the statistics page shows three blocks or one card by, and
   * "off" is the ordinary case, our own production included: no interval,
   * or no credential. The third condition is for a key that was revoked: the
   * batch then runs and writes nothing, and a page that said "on" would be
   * promising summaries that are not coming. It answers true again when the
   * credential is saved again or a call goes through.
   *
   * It does not say that a summary was written lately, and a provider that
   * is down is not "off": conversations wait and are summarised when it
   * answers.
   */
  async isEnabled(): Promise<boolean> {
    if (!this.timer) return false;
    const credential = await this.credential();
    return credential !== null && stampOf(credential) !== this.rejected;
  }

  /** On-demand summarize (admin button). Returns the updated session. */
  async summarize(id: string): Promise<IChatSessionData> {
    const session = await this.chats.findById(id);
    if (!session) throw new NotFoundException(`Chat ${id} not found`);
    const credential = await this.credential();
    if (!credential) {
      throw new BadRequestException(
        'No active Anthropic LLM credential — add one in Settings → LLM credentials.',
      );
    }
    // Whatever came of it, the answer is the conversation as it stands:
    // with its new summary, or as it was when there was nothing to read.
    // By hand a conversation is asked about whenever a person asks: what
    // is set aside is set aside for the batch.
    await this.summarizeSession(session, credential, this.newRun());
    return (await this.chats.findById(id)) ?? session;
  }

  /** Gated cron-batch. Skips entirely when no Anthropic credential exists. */
  async runBatch(): Promise<IChatInsightBatchResult> {
    const empty: IChatInsightBatchResult = {
      eligible: 0,
      summarized: 0,
      skipped: 0,
      failed: 0,
    };
    if (this.running) {
      this.logger.warn('insight batch already running — skipping');
      return empty;
    }
    const credential = await this.credential();
    if (!credential) {
      this.logger.debug('insight batch: no Anthropic credential — skipping');
      return empty;
    }

    this.running = true;
    const result = { ...empty };
    try {
      const now = Date.now();
      const plan = this.planRun(now);
      const found = await this.chats.findEligibleForInsight({
        ...this.gate,
        limit: this.gate.limit + plan.read,
        ...(plan.exclude.length ? { exclude: plan.exclude } : {}),
      });
      const sessions = this.takeFrom(found, plan, now).slice(
        0,
        this.gate.limit,
      );
      result.eligible = sessions.length;
      const run = this.newRun();
      // One after another, never side by side: each conversation reads the
      // vocabulary the one before it may have added to.
      for (const session of sessions) {
        try {
          const attempt = await this.summarizeSession(session, credential, run);
          if (attempt === 'summarized') result.summarized++;
          else if (attempt === 'nothing') result.skipped++;
          else result.failed++;
        } catch (err) {
          result.failed++;
          // A rejected credential (401/403 → BadRequestException) dooms every
          // session — abort the batch instead of hammering the LLM with a bad key.
          if (err instanceof BadRequestException) {
            this.logger.error(
              `insight batch aborted — ${(err as Error).message}`,
            );
            break;
          }
          // Nothing of the model's answer is in the message
          // (`UnusableInsightAnswerError`).
          this.logger.warn(
            `insight failed for ${session.id}: ${(err as Error).message}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
    // `summarized` is summaries written. A conversation with no readable
    // transcript used to be counted there too, and the line then claimed
    // summaries that were not stored.
    this.logger.log(
      `insight batch: eligible=${result.eligible} summarized=${result.summarized} skipped=${result.skipped} failed=${result.failed}`,
    );
    return result;
  }

  /**
   * The credential a summary is made with: the first active one of
   * Anthropic, or null. Public for the calibration script
   * (api/scripts/summary-calibration.ts), which has to measure with the
   * credential the batch would use.
   */
  async credential(): Promise<ILlmCredentialData | null> {
    const active = await this.llms.findActive();
    return (
      active.find((c) => {
        const p = c.provider.toLowerCase();
        return p === 'claude' || p === 'anthropic';
      }) ?? null
    );
  }

  /**
   * What the model says about one conversation: the prompt, the call and
   * the parser of a stored summary, and nothing written. `summarizeSession`
   * goes through here, and so does the calibration script, so that what is
   * measured is what ships.
   *
   * `ask` says whether this conversation takes a topic, and has no default:
   * a caller that left it out would print the vocabulary for a conversation
   * that must not see it (`IInsightAsk`).
   */
  async analyze(
    transcript: string,
    vocabulary: readonly IOfferedTopic[],
    credential: ILlmCredentialData,
    ask: IInsightAsk,
  ): Promise<ParsedInsight> {
    let answer: IModelAnswer;
    try {
      answer = await this.callClaude(
        credential.apiKey,
        credential.model || ANTHROPIC_DEFAULT_MODEL,
        buildInsightPrompt(transcript, vocabulary, ask),
      );
    } catch (err) {
      // 401/403: the provider refuses this credential (see `isEnabled`).
      if (err instanceof BadRequestException) {
        this.rejected = stampOf(credential);
      }
      throw err;
    }
    this.rejected = null;
    // How it ended, before what it says (CLEAN-270). An answer cut at the
    // token limit can hold a complete object from before the cut, and the
    // parser, which takes the first complete one, would store it as if the
    // model had finished. It goes the way of every other unusable answer:
    // nothing stored, and the batch sets the conversation aside
    // (`lastsBeyondARetry`).
    const ended = endedUnusable(answer.stopReason);
    if (ended) throw new UnusableInsightAnswerError(ended, answer.text.length);
    const raw = answer.text;
    const parsed = parseInsights(raw, vocabulary, ask);
    if (!parsed) {
      throw new UnusableInsightAnswerError(
        unusableAnswerReason(raw) ?? 'no JSON object',
        raw.length,
      );
    }
    return parsed;
  }

  /**
   * What one run, or one summary by hand, reads once and keeps (`IRun`).
   *
   * How much each topic is used is a pass over every conversation
   * (`topicUsageQuery`), 0.5 to 0.7 s on a database of 1 005 120
   * conversations, 300 912 of them with a topic (measured, CLEAN-270). The
   * batch made it for every conversation it summarised, so a run of 25
   * scanned the table 25 times: about 15 s of scanning per run at that
   * size, every quarter of an hour, to learn 25 times what changes by one
   * conversation at a time. Nothing but the run itself moves the counts
   * while it runs in a way the order needs (the batch is the one writer of
   * topics, bar a summary asked for by hand), so the run counts what it
   * assigns: `summarizeSession` takes out what a conversation carried and
   * adds what it carries now.
   *
   * The topics themselves are still read for every conversation
   * (`vocabulary`, a row per subject): that read is what lets a topic one
   * conversation coined be offered to the next.
   *
   * On first need, not at the start: a run with nothing to summarise, the
   * ordinary one, reads nothing.
   */
  private newRun(): IRun {
    return {
      tally: once(() => this.topics.usageCounts()),
      ownerOnly: once(
        async () => new Set(await this.permission.ownerOnlyAgentIds()),
      ),
      always: new Set(),
    };
  }

  /**
   * What this run asks the index for besides its 25, given the ones set
   * aside that are still waiting (`now` before their `until`).
   *
   * Up to `SET_ASIDE_READ_MAX` of them are read and skipped: `read` more
   * rows are asked for, so the run stays full of conversations that can be
   * summarised, and a waiting one that is not among the rows has left and
   * is forgotten (`takeFrom`). The rest are named to the query, which
   * leaves them out without reading them, each as it stood when it was set
   * aside, so that one in which something new was said is found again.
   *
   * Which ones are read takes turns: the ones read on this run go to the
   * back of the order. So every entry is looked at within a few runs, and
   * one that left while it was only named does not stay for good.
   */
  private planRun(now: number): {
    read: number;
    exclude: IChatInsightExclusion[];
    /** The ids named to the query: this run cannot tell whether they left. */
    unseen: Set<string>;
  } {
    const waiting = [...this.setAside].filter(([, aside]) => now < aside.until);
    const read = waiting.slice(0, SET_ASIDE_READ_MAX);
    const named = waiting.slice(SET_ASIDE_READ_MAX);
    if (named.length) {
      for (const [id, aside] of read) {
        this.setAside.delete(id);
        this.setAside.set(id, aside);
      }
    }
    return {
      read: read.length,
      exclude: named.map(([id, aside]) => ({
        id,
        lastMessageAt: new Date(aside.lastMessageAt),
      })),
      unseen: new Set(named.map(([id]) => id)),
    };
  }

  /**
   * The conversations of `found` this run takes, in the order found, and
   * the upkeep of the ones set aside:
   *
   *  - an entry the query could have found and did not is forgotten: its
   *    conversation was summarised by hand, is no longer eligible, or lies
   *    behind more new conversations than a run takes, in which case it is
   *    set aside again when its turn comes;
   *  - an entry whose conversation has moved is forgotten, and the
   *    conversation taken;
   *  - an entry whose time is over lets its conversation through. It stays
   *    for that one attempt, which either forgets it (a summary) or writes
   *    it anew, with the count of failures it carries;
   *  - an entry still waiting keeps its conversation out.
   */
  private takeFrom(
    found: IChatSessionData[],
    plan: { unseen: ReadonlySet<string> },
    now: number,
  ): IChatSessionData[] {
    const foundIds = new Set(found.map((session) => session.id));
    for (const id of [...this.setAside.keys()]) {
      if (!foundIds.has(id) && !plan.unseen.has(id)) this.setAside.delete(id);
    }
    return found.filter((session) => {
      const aside = this.setAside.get(session.id);
      if (!aside) return true;
      if (aside.lastMessageAt !== session.lastMessageAt.getTime()) {
        this.setAside.delete(session.id);
        return true;
      }
      return now >= aside.until;
    });
  }

  /** Set the conversation aside, as it stands, until `until`. */
  private putAside(
    session: IChatSessionData,
    until: number,
    failures = 0,
  ): void {
    // Anew, at the back of the order: it was looked at just now.
    this.setAside.delete(session.id);
    if (this.setAside.size >= SET_ASIDE_MAX) {
      const oldest = this.setAside.keys().next();
      if (!oldest.done) this.setAside.delete(oldest.value);
    }
    this.setAside.set(session.id, {
      lastMessageAt: session.lastMessageAt.getTime(),
      until,
      failures,
    });
  }

  /**
   * Set aside a conversation the model could give no usable answer about:
   * for an hour the first time, twice as long each time in a row after
   * that, at most a day. The count is of failures on this text: an entry
   * made when the conversation's last message was another one is not
   * counted on.
   */
  private backOff(session: IChatSessionData): void {
    const before = this.setAside.get(session.id);
    const failures =
      (before && before.lastMessageAt === session.lastMessageAt.getTime()
        ? before.failures
        : 0) + 1;
    const wait = Math.min(
      UNUSABLE_BACKOFF_START_MS * 2 ** (failures - 1),
      UNUSABLE_BACKOFF_MAX_MS,
    );
    this.putAside(session, Date.now() + wait, failures);
  }

  /**
   * What became of the conversation: a summary written, nothing to read, or
   * a transcript that could not be read. The last two set it aside for the
   * batch (`setAside`) and write nothing. So does an answer of the model
   * that cannot be used, which is thrown.
   */
  private async summarizeSession(
    session: IChatSessionData,
    credential: ILlmCredentialData,
    run: IRun,
  ): Promise<Attempt> {
    let transcript: string;
    try {
      transcript = await this.loadTranscript(session);
    } catch (err) {
      this.putAside(session, Date.now() + COOLDOWN_MS);
      this.logger.warn(
        `insight: the transcript of ${session.id} could not be read: ${(err as Error).message}`,
      );
      return 'unreadable';
    }
    if (!transcript.trim()) {
      this.putAside(session, Infinity);
      return 'nothing';
    }

    // A conversation with an agent only the Owner manages takes no topic
    // (CLEAN-270, review). The vocabulary is the installation's: a topic is
    // shown to every operator, and one coined from a conversation nobody
    // but the Owner may read would be a reading of it handed to everybody.
    // So such a conversation is not shown the vocabulary, is asked for no
    // topic, and is stored with none; its summary, question, outcome, tone
    // and language are its own and are written as for any other.
    //
    // Asked before the model is: when the answer cannot be had (the
    // database is down), this throws and there is no summary on this run.
    // Not knowing is not "none of them".
    const withTopics = !(await run.ownerOnly()).has(session.agentId);

    // The topics it carries from an earlier summary, as the tally counts
    // them: each under the topic that stands for it, once.
    const carried = session.topicIds.length
      ? new Set(
          [...(await this.topics.findByIds(session.topicIds)).values()].map(
            (topic) => topic.id,
          ),
        )
      : new Set<string>();
    // Read when this conversation is offered topics or gives one up; a
    // conversation that does neither leaves the pass over the table unmade.
    const counts = withTopics || carried.size ? await run.tally() : null;

    // Read for this conversation, not once for the batch: a topic the
    // previous conversation coined has to be in the list, or the same new
    // subject gets a second label within one run (data-model.md, ChatTopic).
    // Ordered by the run's tally, which that conversation has been added
    // to, and with the run's own topics among them whatever their count.
    const vocabulary =
      withTopics && counts
        ? await this.topics.vocabulary(VOCABULARY_CAP, counts, run.always)
        : [];

    let parsed: ParsedInsight;
    try {
      parsed = await this.analyze(transcript, vocabulary, credential, {
        topics: withTopics,
      });
    } catch (err) {
      if (lastsBeyondARetry(err)) this.backOff(session);
      throw err;
    }

    // The second lock on a conversation that takes no topic. The parser
    // has already read none from its answer; whatever `parsed` holds, none
    // is looked up, coined or stored for it.
    const assigned = withTopics
      ? await this.topicsOf(parsed, vocabulary, run)
      : [];

    await this.chats.saveInsights(session.id, {
      summary: parsed.summary,
      question: parsed.question,
      outcome: parsed.outcome,
      topicIds: assigned.map((t) => t.id),
      // The Json of version 1, still written for the admin console's chat
      // pages: labels where it had free-text tags, and the boolean it had,
      // true for `resolved` only.
      insights: {
        topics: assigned.map((t) => topicLabel(t, INSIGHTS_LANGUAGE)),
        sentiment: parsed.sentiment,
        resolved: parsed.outcome === ChatOutcomeTypes.Resolved,
        language: parsed.language,
      },
    });
    this.setAside.delete(session.id);
    // Stored: the conversation is counted once, under what it carries now.
    if (counts) {
      for (const id of carried) count(counts, id, -1);
      for (const topic of assigned) count(counts, topic.id, 1);
    }
    return 'summarized';
  }

  /**
   * The topics a conversation is stored with: the offered keys the model
   * called a clear fit and, when there was none, what became of its
   * proposal.
   */
  private async topicsOf(
    parsed: ParsedInsight,
    vocabulary: readonly IChatTopicData[],
    run: IRun,
  ): Promise<IChatTopicData[]> {
    const assigned: IChatTopicData[] = [];
    for (const key of parsed.topicKeys) {
      const topic = vocabulary.find((t) => t.key === key);
      if (topic) assigned.push(topic);
    }
    if (parsed.proposal) {
      const topic = await this.proposed(parsed.proposal, vocabulary, run);
      if (topic && !assigned.some((t) => t.id === topic.id)) {
        assigned.push(topic);
      }
    }
    return assigned;
  }

  /**
   * The topic a proposal becomes, or null for none (CLEAN-270, review).
   *
   * The key is read as the topic it stands for: the one that has it, or the
   * one that one was merged into.
   *
   *  - That topic was in the list this conversation was offered: no topic.
   *    The model had it in front of it and did not call it a clear fit (it
   *    called it loose, or did not name it), and the contract stores an
   *    offered topic as a clear fit or not at all
   *    (contracts/summary-judgments.md, judgment 1, the threshold). The
   *    proposal used to be assigned by its key regardless, which let
   *    "loose" become "stored" by naming the key a second time as new.
   *  - That topic exists and was not offered, being outside the sixty: it
   *    is assigned, with the labels it has. The contract says so of a key
   *    outside the list: "reused rather than duplicated". The rest of the
   *    run is offered it.
   *  - No topic has the key: it is coined, unless as many topics stand as
   *    may (`TOPICS_STANDING_MAX`), in which case the proposal is dropped
   *    and the conversation has no topic.
   */
  private async proposed(
    proposal: IProposedTopic,
    vocabulary: readonly IChatTopicData[],
    run: IRun,
  ): Promise<IChatTopicData | null> {
    const standing = await this.topics.standingByKey(proposal.key);
    if (standing) {
      if (vocabulary.some((offered) => offered.id === standing.id)) return null;
      run.always.add(standing.id);
      return standing;
    }
    if ((await this.topics.countStanding()) >= TOPICS_STANDING_MAX) {
      return null;
    }
    const coined = await this.topics.findOrCreateByKey(
      proposal.key,
      proposal.labels,
    );
    run.always.add(coined.id);
    return coined;
  }

  /**
   * The conversation as the prompt reads it; empty when there is no
   * transcript or no message in it. Any other failure of the read is
   * thrown: the file may well be there, and "nothing to summarise" would be
   * a guess.
   */
  private async loadTranscript(session: IChatSessionData): Promise<string> {
    const path = `data/sessions/${session.sessionKey}.jsonl`;
    let messages;
    try {
      messages = await this.reader.read(session.agentId, path, {
        types: ['user', 'assistant'],
        filterTransient: true,
      });
    } catch (err) {
      // No file is not a file that cannot be read (a session removed by
      // hand, an agent whose storage was emptied): nothing to summarise.
      if (err instanceof NotFoundException) return '';
      throw err;
    }
    return transcriptText(messages);
  }

  /**
   * One call, not streamed. The body is the model, the limit and the
   * prompt, and nothing else on purpose (`INSIGHT_MAX_TOKENS`).
   *
   * Answers the text with how the answer ended, and judges neither: a
   * status of 200 says that the provider answered, not that the answer is
   * whole (`endedUnusable`).
   */
  private async callClaude(
    apiKey: string,
    model: string,
    prompt: string,
  ): Promise<IModelAnswer> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        // OAuth subscription tokens (sk-ant-oat…, what the bots run on) must go
        // as Bearer + claude-code beta, not x-api-key — see anthropicAuthHeaders.
        ...anthropicAuthHeaders(apiKey),
      },
      body: JSON.stringify({
        model,
        max_tokens: INSIGHT_MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) {
        throw new BadRequestException(
          `Anthropic rejected the API key (${res.status}) — update the Anthropic credential in Settings → LLM credentials.`,
        );
      }
      throw new ProviderStatusError(
        res.status,
        `Anthropic API ${res.status}: ${body.slice(0, 200)}`,
      );
    }
    const json = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
      stop_reason?: string | null;
    };
    return {
      // By type: a model that thinks begins its answer with `thinking`
      // blocks, which have no `text`.
      text: (json.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('\n')
        .trim(),
      stopReason:
        typeof json.stop_reason === 'string' ? json.stop_reason : null,
    };
  }
}
