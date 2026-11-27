import { ISeedTopic, sameSubject, seedKeyOf } from './sample';

// The numbers of a calibration (CLEAN-270, spec 038
// contracts/summary-judgments.md). Pure: what the person said and what the
// model said go in, counts come out. Every number is a count out of a
// total, and keeps both: a sample of 25 conversations gives percentages
// that mean little without the total beside them.

/** `hits` out of `of`. `share` is null when there is nothing to divide by. */
export interface IRatio {
  hits: number;
  of: number;
  share: number | null;
}

export function ratio(hits: number, of: number): IRatio {
  return { hits, of, share: of > 0 ? hits / of : null };
}

/** "75.0% (3 of 4)", or "n/a (0 of 0)" when the class is empty. */
export function formatRatio(r: IRatio): string {
  const share = r.share === null ? 'n/a' : `${(r.share * 100).toFixed(1)}%`;
  return `${share} (${r.hits} of ${r.of})`;
}

/** One conversation, as the person and the model each sorted it. */
export interface IJudgedTopics {
  n: number;
  /** The person's subject; null for "no subject". */
  subject: string | null;
  /** The keys the summary would store: clear fits, or the topic it coined. */
  topics: string[];
  /** The keys the model marked `loose`: never stored. */
  loose: string[];
}

export interface ITopicScores {
  /**
   * Pairs of conversations compared: n × (n − 1) / 2, less `leftOut`.
   */
  pairs: number;
  /**
   * Pairs that were not compared: neither the person nor the model named a
   * subject for either conversation. In no count and in no share.
   */
  leftOut: number;
  /** Pairs the two agree on, "same" or "different". */
  agreement: IRatio;
  /** Of the pairs the model put under one topic, those the person did too. */
  samePrecision: IRatio;
  /** Of the pairs the person put under one subject, those with a common topic. */
  sameRecall: IRatio;
  /** Of the pairs joined by a topic both got as `clear`, those the person joined. */
  clearAgreed: IRatio;
  /** The same for pairs joined by a topic at least one got as `loose`. */
  looseAgreed: IRatio;
  /** The pairs they disagree on, by conversation number. */
  disagreements: Array<{ a: number; b: number; person: 'same' | 'different' }>;
}

const shares = (a: readonly string[], b: readonly string[]) =>
  a.some((key) => b.includes(key));

/** Nobody named a subject for it: no subject, and no topic clear or loose. */
const unnamed = (item: IJudgedTopics) =>
  item.subject === null && !item.topics.length && !item.loose.length;

/**
 * How well the model's topics match the person's subjects.
 *
 * The two share no vocabulary: the person wrote subjects in their own
 * words, the model chose or coined keys. So nothing is compared label to
 * label. Every pair of conversations is asked one question of each side,
 * "are these two about the same subject?": the person says yes when they
 * wrote the same words for both, the model when the two would be stored
 * with a topic in common. A conversation with no subject, or with no topic,
 * is the same as nothing.
 *
 * One kind of pair is left out (CLEAN-270, review): the person wrote no
 * subject for either conversation, and the model gave neither a topic,
 * clear or loose. Nobody said anything about such a pair, and it used to be
 * counted as "both call different": thirty conversations of small talk are
 * 435 agreements that nobody made, in a number read as how well the model
 * sorts. It is counted in `leftOut` and in nothing else. A pair one side
 * did name a subject for stays: there the other side's silence is an answer.
 *
 * The fit is judged the same way, since a labeller cannot agree with a key
 * they never saw: of the pairs a topic joins, how many did the person join.
 * `clear` when both conversations got that topic as a clear fit, `loose`
 * when at least one of them got it only loosely. Two numbers that can be
 * compared, which is what the contract's "within 5 points" needs.
 *
 * Counted this way the agreement with `clear` is the precision of "same"
 * under another name: what is stored is the clear fits, so the pairs a
 * clear topic joins are the pairs the model calls the same. It is kept as a
 * field of its own because the contract asks for it by that name.
 */
export function topicScores(items: readonly IJudgedTopics[]): ITopicScores {
  let pairs = 0;
  let leftOut = 0;
  let agreed = 0;
  let bothSame = 0;
  let modelSame = 0;
  let personSame = 0;
  let clearPairs = 0;
  let clearAgreed = 0;
  let loosePairs = 0;
  let looseAgreed = 0;
  const disagreements: ITopicScores['disagreements'] = [];

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const first = items[i];
      const second = items[j];
      if (unnamed(first) && unnamed(second)) {
        leftOut++;
        continue;
      }
      pairs++;
      const person = sameSubject(first.subject, second.subject);
      const model = shares(first.topics, second.topics);
      if (person) personSame++;
      if (model) modelSame++;
      if (person && model) bothSame++;
      if (person === model) {
        agreed++;
      } else {
        disagreements.push({
          a: first.n,
          b: second.n,
          person: person ? 'same' : 'different',
        });
      }

      if (model) {
        clearPairs++;
        if (person) clearAgreed++;
      }
      // Joined by a key that is loose on at least one side: loose with
      // loose, or loose with a clear fit of the other.
      const loosely =
        shares(first.loose, second.loose) ||
        shares(first.loose, second.topics) ||
        shares(first.topics, second.loose);
      if (loosely) {
        loosePairs++;
        if (person) looseAgreed++;
      }
    }
  }

  return {
    pairs,
    leftOut,
    agreement: ratio(agreed, pairs),
    samePrecision: ratio(bothSame, modelSame),
    sameRecall: ratio(bothSame, personSame),
    clearAgreed: ratio(clearAgreed, clearPairs),
    looseAgreed: ratio(looseAgreed, loosePairs),
    disagreements,
  };
}

export interface IGivenListScores {
  /**
   * Of the conversations whose reference subject is a seeded one, those
   * stored with the topic of that subject as a clear fit.
   */
  chosen: IRatio;
  /** Of those, the ones stored with a second topic besides. */
  chosenWithSecond: number;
  /** The rest, stored with a seeded topic that is not the reference's. */
  otherSeeded: number;
  /** The rest, stored with no topic. */
  noTopic: number;
  /** The rest, stored only with a topic coined during the run. */
  coined: number;
  /**
   * The rest one by one: what the model stored, and the seeded key of the
   * reference's subject. Keys and a number, nothing else of a conversation.
   */
  misses: Array<{ n: number; model: string[]; reference: string }>;
  /** Conversations whose reference subject is not a seeded one: in no share. */
  notInList: number[];
  /** "No subject" by the reference, and stored with no topic. */
  noSubjectNoTopic: number;
  /** "No subject" by the reference, and stored with a topic. */
  noSubjectGivenTopic: number[];
}

/**
 * How the model chose from a list it was given (`--vocabulary`).
 *
 * The pairs of `topicScores` compare two ways of cutting the sample into
 * groups, each with words of its own. Here both sides have one list: the run
 * started with the seeded topics, and each of them stands for one subject of
 * the reference (`seedKeyOf`). So a conversation is right or wrong by
 * itself: it was stored with the topic of its reference subject, or it was
 * not.
 *
 * Counted over the conversations whose reference subject is a seeded one. A
 * subject the file does not have has no right answer in the list, so its
 * conversation is in no share and is counted apart; "no subject" is counted
 * apart too, by whether the model left it without a topic as well.
 *
 * A conversation is stored with up to two topics. It is chosen right when
 * the reference's is one of them, and how many of those carry a second is
 * kept beside the count, since two answers have two chances. A miss stored
 * with a seeded topic and with one coined earlier in the run is counted as
 * "another seeded topic": the model chose from the list, and chose wrong.
 */
export function givenListScores(
  items: readonly IJudgedTopics[],
  seed: ReadonlyArray<Pick<ISeedTopic, 'key' | 'subject'>>,
): IGivenListScores {
  const seeded = new Set(seed.map((topic) => topic.key));
  let withSubject = 0;
  let chosen = 0;
  let chosenWithSecond = 0;
  let otherSeeded = 0;
  let noTopic = 0;
  let coined = 0;
  let noSubjectNoTopic = 0;
  const misses: IGivenListScores['misses'] = [];
  const notInList: number[] = [];
  const noSubjectGivenTopic: number[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.subject === null) {
      if (item.topics.length) noSubjectGivenTopic.push(item.n);
      else noSubjectNoTopic++;
      continue;
    }
    const reference = seedKeyOf(item.subject, seed);
    if (reference === null) {
      notInList.push(item.n);
      continue;
    }
    withSubject++;
    if (item.topics.includes(reference)) {
      chosen++;
      if (item.topics.length > 1) chosenWithSecond++;
      continue;
    }
    misses.push({ n: item.n, model: [...item.topics], reference });
    if (!item.topics.length) noTopic++;
    else if (item.topics.some((key) => seeded.has(key))) otherSeeded++;
    else coined++;
  }

  return {
    chosen: ratio(chosen, withSubject),
    chosenWithSecond,
    otherSeeded,
    noTopic,
    coined,
    misses,
    notInList,
    noSubjectNoTopic,
    noSubjectGivenTopic,
  };
}

/** How one conversation ended: by the person, and by the model. */
export interface IJudgedOutcome {
  n: number;
  person: string;
  model: string;
}

export interface IOutcomeScores {
  /** Of what the model called `outcome`, how much the person did. */
  precision: IRatio;
  /** Of what the person called `outcome`, how much the model did. */
  recall: IRatio;
  /** Conversations the model called `outcome` and the person did not. */
  wronglyCalled: number[];
  /** Conversations the person called `outcome` and the model did not. */
  missed: number[];
}

export function outcomeScores(
  items: readonly IJudgedOutcome[],
  outcome: string,
): IOutcomeScores {
  let both = 0;
  let byModel = 0;
  let byPerson = 0;
  const wronglyCalled: number[] = [];
  const missed: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const model = item.model === outcome;
    const person = item.person === outcome;
    if (model) byModel++;
    if (person) byPerson++;
    if (model && person) both++;
    if (model && !person) wronglyCalled.push(item.n);
    if (person && !model) missed.push(item.n);
  }
  return {
    precision: ratio(both, byModel),
    recall: ratio(both, byPerson),
    wronglyCalled,
    missed,
  };
}

/** Topics coined, scaled to a hundred conversations; null for none run. */
export function coinedPer100(
  coined: number,
  conversations: number,
): number | null {
  return conversations > 0 ? (coined / conversations) * 100 : null;
}
