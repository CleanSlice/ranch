/**
 * Deletes chats that carry Russian, after archiving them (CLEAN-169).
 *
 * RUNBOOK (run inside the ranch-api pod — it has DATABASE_URL and S3 access):
 *   kubectl -n <ns> exec <pod> -- bun dist/scripts/purgeRussianChats.js
 *   # review the report, then, to actually delete:
 *   kubectl -n <ns> exec <pod> -- bun dist/scripts/purgeRussianChats.js \
 *     --delete --archive /tmp/purged-ru.jsonl
 *   kubectl -n <ns> cp <pod>:/tmp/purged-ru.jsonl ./purged-ru.jsonl
 *
 * The dry run is the DEFAULT here, the inverse of the other scripts: this one
 * destroys chats. `--delete` without `--archive` is refused.
 *
 * The archive is one JSONL line per deleted chat — the index row plus the
 * whole transcript — written to a path inside the pod, not to S3. DevOps
 * copies it off and keeps it wherever the customer agreed; nothing is left
 * behind on prod, which is what "remove from prod" was asked to mean.
 *
 * Selection is by Cyrillic in the transcript, never by `insights.language`:
 * see purgeRussianChats/detect.ts for why.
 *
 * Deliberately does NOT boot the Nest AppModule: its onModuleInit hooks have
 * production side effects (agent auto-restart, knowledge index state resets,
 * reconcile timers). The few gateways needed are constructed by hand.
 */
import { appendFileSync } from 'fs';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { SettingGateway } from '#/setting/data/setting.gateway';
import { SettingMapper } from '#/setting/data/setting.mapper';
import { S3FileGateway } from '#/agent/file/data/file.gateway';
import { TranscriptReaderService } from '#/agent/file/domain';
import { parsePurgeArgs, type PurgeArgs } from './purgeRussianChats/args';
import { scanTranscript, type ICyrillicScan } from './purgeRussianChats/detect';

interface ICandidate {
  id: string;
  agentId: string;
  sessionKey: string;
  channel: string;
  externalUserId: string;
  title: string | null;
  lastMessageAt: Date;
  messageCount: number;
  insights: unknown;
}

interface IHit {
  session: ICandidate;
  scan: ICyrillicScan;
  messages: { role: string; text: string; ts: number }[];
}

async function inBatches<T>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

/** Same formula as the chat controller, the chat tool and the summarizer. */
function transcriptPath(sessionKey: string): string {
  return `data/sessions/${sessionKey}.jsonl`;
}

/** What the summarizer thought the language was — reported, never obeyed. */
function statedLanguage(insights: unknown): string {
  if (!insights || typeof insights !== 'object') return '-';
  const value = (insights as Record<string, unknown>).language;
  return typeof value === 'string' ? value : '-';
}

async function main(): Promise<void> {
  // Parse before connecting: a typo in the runbook should answer at once,
  // not after a database round trip.
  const args: PurgeArgs = parsePurgeArgs(process.argv.slice(2));

  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    if (args.agent) {
      const agent = await prisma.agent.findUnique({
        where: { id: args.agent },
      });
      if (!agent) throw new Error(`--agent "${args.agent}" not found`);
      console.log(`scope:            ${agent.id} (${agent.name})`);
    } else {
      console.log('scope:            every agent');
    }

    const found = await prisma.chatSession.findMany({
      orderBy: { lastMessageAt: 'asc' },
      ...(args.agent ? { where: { agentId: args.agent } } : {}),
      select: {
        id: true,
        agentId: true,
        sessionKey: true,
        channel: true,
        externalUserId: true,
        title: true,
        lastMessageAt: true,
        messageCount: true,
        insights: true,
      },
    });
    const candidates = args.limit === null ? found : found.slice(0, args.limit);

    const files = new S3FileGateway(
      new SettingGateway(prisma, new SettingMapper()),
    );
    const reader = new TranscriptReaderService(files);

    const hits: IHit[] = [];
    let unreadable = 0;
    await inBatches(candidates, args.concurrency, async (session) => {
      try {
        const messages = await reader.read(
          session.agentId,
          transcriptPath(session.sessionKey),
        );
        const scan = scanTranscript(messages);
        if (scan.hit) hits.push({ session, scan, messages });
      } catch (err) {
        // A row whose object is gone cannot be judged either way, so it is
        // reported and left alone rather than guessed about.
        unreadable++;
        console.error(
          `unreadable ${session.sessionKey}: ${(err as Error).message}`,
        );
      }
    });

    hits.sort(
      (a, b) =>
        a.session.lastMessageAt.getTime() - b.session.lastMessageAt.getTime(),
    );
    const botOnly = hits.filter((h) => h.scan.userChars === 0).length;

    console.log(`chats scanned:    ${candidates.length}`);
    console.log(`  unreadable:     ${unreadable}`);
    console.log(`  with Cyrillic:  ${hits.length}`);
    console.log(`    bot side only: ${botOnly}`);

    for (const { session, scan } of hits) {
      console.log(
        `hit ${session.sessionKey} — user=${scan.userChars} bot=${scan.assistantChars} ` +
          `msgs=${session.messageCount} lang=${statedLanguage(session.insights)} ` +
          `last=${session.lastMessageAt.toISOString()}`,
      );
    }

    if (args.dryRun) {
      console.log('dry run — nothing deleted. Add --delete --archive <path>.');
      return;
    }

    const archive = args.archive as string;
    let deleted = 0;
    let orphans = 0;
    let errors = 0;

    // Sequential: the archive is append-only and a half-written line would
    // be the one record of a chat that no longer exists anywhere.
    for (const hit of hits) {
      try {
        appendFileSync(
          archive,
          JSON.stringify({
            ...hit.session,
            lastMessageAt: hit.session.lastMessageAt.toISOString(),
            cyrillic: hit.scan,
            messages: hit.messages,
          }) + '\n',
          'utf-8',
        );

        // Row first, object second. The reverse of the CLEAN-168 copy: a row
        // pointing at a missing transcript renders as a chat that opens
        // empty, while an object with no row is invisible to everyone.
        // ChatFeedback goes with the row by onDelete: Cascade.
        await prisma.chatSession.delete({ where: { id: hit.session.id } });

        try {
          await files.delete(
            hit.session.agentId,
            transcriptPath(hit.session.sessionKey),
          );
        } catch (err) {
          orphans++;
          console.error(
            `orphan object ${hit.session.agentId}/${transcriptPath(hit.session.sessionKey)}: ` +
              `${(err as Error).message}`,
          );
        }

        deleted++;
        if (deleted % 200 === 0) console.log(`… ${deleted}/${hits.length}`);
      } catch (err) {
        errors++;
        console.error(
          `chat ${hit.session.sessionKey} failed: ${(err as Error).message}`,
        );
      }
    }

    console.log(`chats deleted:    ${deleted} (${errors} failed)`);
    console.log(`archive:          ${archive}`);
    if (orphans > 0) {
      console.log(
        `orphan objects:   ${orphans} — rows are gone, these S3 keys need a manual sweep`,
      );
    }
    console.log(
      'Analytics rollups are not touched here: Top questions reads AnalyticsAggregate, ' +
        'which lives in the customer fork.',
    );

    if (errors > 0) {
      throw new Error(`${errors} chat(s) failed — re-run is safe`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: Error) => {
  console.error(`[purge] ${err.message}`);
  process.exit(1);
});
