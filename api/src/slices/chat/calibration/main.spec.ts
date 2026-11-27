import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { main } from './main';

// The two things a real run takes from outside the process: the database it
// reads the credential from, and the model. Both are replaced here; the
// summary service between them is the real one.
let mockCredentials: Array<Record<string, unknown>> = [];
const mockConnections = { opened: 0, closed: 0 };
jest.mock('#/setup/prisma/prisma.service', () => ({
  PrismaService: class {
    $connect() {
      mockConnections.opened++;
      return Promise.resolve();
    }
    $disconnect() {
      mockConnections.closed++;
      return Promise.resolve();
    }
  },
}));
jest.mock('#/llm/data/llm.gateway', () => ({
  LlmGateway: class {
    findActive() {
      return Promise.resolve(mockCredentials);
    }
  },
}));

const transcript = (n: number, chatId: string, texts: string[]) =>
  JSON.stringify({
    n,
    chatId,
    agent: 'alpha',
    lastMessageAt: '2026-11-20T09:00:00Z',
    messages: texts.map((text, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      ts: i,
      text,
    })),
  });

const run = async (argv: string[]) => {
  const printed: unknown[][] = [];
  const code = await main(argv, (...args: unknown[]) => {
    printed.push(args);
  });
  return { code, printed, text: printed.map((args) => args[0]).join('\n') };
};

/**
 * The dry run, end to end over a sample on disk: everything but the model
 * call. It opens no database, so it runs here as it runs on a developer's
 * machine with no credential.
 */
describe('summary calibration, dry', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'calibration-sample-'));
    mkdirSync(join(dir, 'transcripts'));
    writeFileSync(
      join(dir, 'transcripts', '001.json'),
      transcript(1, 'chat-one', ['SPOKEN-ONE how do I reset it?', 'Like so.']),
    );
    writeFileSync(
      join(dir, 'transcripts', '002.json'),
      transcript(2, 'chat-two', ['SPOKEN-TWO my invoice is missing']),
    );
    writeFileSync(
      join(dir, 'transcripts', '003.json'),
      transcript(3, 'chat-three', ['SPOKEN-THREE reset again', 'Done.']),
    );
    writeFileSync(
      join(dir, 'labels.csv'),
      '﻿' +
        [
          'n,chatId,agent,lastMessageAt,messages,subject,outcome,note',
          '"1","chat-one","alpha","x","2","LABELLED password","resolved",""',
          '"2","chat-two","alpha","x","1","","",""',
          '"3","chat-three","alpha","x","2","labelled PASSWORD","open",""',
        ].join('\r\n') +
        '\r\n',
    );
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('prints the counts and the size of the prompt, one line at a time', async () => {
    mockConnections.opened = 0;
    const { code, printed, text } = await run(['--sample', dir, '--dry']);

    expect(code).toBe(0);
    expect(mockConnections.opened).toBe(0);
    // A line, and nothing after it.
    for (const args of printed) {
      expect(args).toHaveLength(1);
      expect(typeof args[0]).toBe('string');
    }
    expect(text).toContain('summary calibration: prompt version 2');
    expect(text).toContain('dry run: the model was not called');
    expect(text).toContain('conversations in the sample: 3');
    expect(text).toContain('labelled: 2; unlabelled, skipped: 1 (n: 2)');
    expect(text).toContain('resolved 1, open 1, cannot tell 0; 1 subjects');
    expect(text).toContain('pairs the person put under one subject: 1 of 1\n');
    // As the service would build them: no list, and no topics question.
    expect(text).toMatch(
      /prompts built: 3, with an empty vocabulary and so with no topics question/,
    );
  });

  it('prints nothing of what was said, and nothing the labeller wrote', async () => {
    const { text } = await run(['--sample', dir, '--dry']);
    // Case matters here: "labelled" is a word of the report itself.
    expect(text).not.toMatch(/SPOKEN|LABELLED|password|PASSWORD|invoice/);
  });

  it('answers 2 and the usage for arguments it cannot read', async () => {
    const { code, text } = await run(['--dry']);
    expect(code).toBe(2);
    expect(text).toContain('--sample <dir> is required');
    expect(text).toContain('usage:');
    // The usage names every flag there is.
    expect(text).toContain('--sample <dir> [--dry] [--topics]');
    expect(text).toMatch(/--topics {2}after the report, list the topics/);
  });

  // The model was not called, so there is no topic: said, not left blank.
  it('has no topics to list, and says so when asked for them', async () => {
    const asked = await run(['--sample', dir, '--dry', '--topics']);
    expect(asked.code).toBe(0);
    expect(asked.text).toContain(
      '--topics: nothing to list, a dry run makes no topics.',
    );
    expect(asked.text).not.toContain('Topics of the run');

    const plain = await run(['--sample', dir, '--dry']);
    expect(plain.text).not.toContain('--topics');
  });

  // `--dry --vocabulary`: the file is checked and counted against the
  // labels, and the prompts are built with its topics. Still no model, no
  // credential, no database.
  describe('with --vocabulary', () => {
    const origFetch = global.fetch;
    let fetched: jest.Mock;
    let file: string;

    beforeEach(() => {
      fetched = jest.fn();
      global.fetch = fetched as unknown as typeof fetch;
      file = join(dir, 'vocabulary.json');
      writeFileSync(
        file,
        JSON.stringify([
          {
            key: 'account-access',
            labels: { en: 'Account access', ru: 'Доступ' },
            subject: 'LABELLED password',
          },
          {
            key: 'deliveries',
            labels: { en: 'Deliveries', ru: 'Доставка' },
            subject: 'LABELLED parcel',
          },
        ]),
      );
    });
    afterEach(() => {
      global.fetch = origFetch;
    });

    it('says how many topics it seeds and how many labelled conversations have a subject among them', async () => {
      mockConnections.opened = 0;
      const { code, printed, text } = await run([
        '--sample',
        dir,
        '--dry',
        '--vocabulary',
        file,
      ]);

      expect(code).toBe(0);
      expect(fetched).not.toHaveBeenCalled();
      expect(mockConnections.opened).toBe(0);
      for (const args of printed) expect(args).toHaveLength(1);
      expect(text).toContain(
        '--vocabulary: 2 topics seeded, listed in the first prompt in the order of the file',
      );
      // 1 and 3 are labelled, both with the subject of the first topic.
      expect(text).toContain(
        'labelled conversations with a reference subject in the list: 2 of 2; with no subject: 0; with a subject not in the list, in no share: 0',
      );
      expect(text).toContain(
        'seeded topics whose subject no labelled conversation has: 1 (deliveries)',
      );
      expect(text).toMatch(/prompts built: 3, with the 2 seeded topics listed/);
      expect(text).not.toContain('empty vocabulary');
      // Keys, and nothing the reference wrote; of a topic not its labels.
      expect(text).not.toMatch(/SPOKEN|LABELLED|password|PASSWORD|parcel/);
      expect(text).not.toMatch(/Account access|Доступ|Доставка/);
    });

    it('counts a subject the file does not have, by the number of its conversation', async () => {
      writeFileSync(
        file,
        JSON.stringify([
          {
            key: 'deliveries',
            labels: { en: 'Deliveries', ru: 'Доставка' },
            subject: 'LABELLED parcel',
          },
        ]),
      );

      const { code, text } = await run([
        '--vocabulary',
        file,
        '--sample',
        dir,
        '--dry',
      ]);

      expect(code).toBe(0);
      expect(text).toContain(
        'labelled conversations with a reference subject in the list: 0 of 2; with no subject: 0; with a subject not in the list, in no share: 2 (n: 1, 3)',
      );
    });

    it('answers 2 for a file it cannot read, by the entry and never by what is in it', async () => {
      writeFileSync(
        file,
        JSON.stringify([
          { key: 'LABELLED password', labels: {}, subject: 'LABELLED' },
        ]),
      );
      const bad = await run(['--sample', dir, '--dry', '--vocabulary', file]);
      expect(bad.code).toBe(2);
      expect(bad.text).toContain(
        'cannot read the vocabulary: the vocabulary file: entry 1 has no key the summary would store as written',
      );
      expect(bad.text).not.toMatch(/LABELLED|password/);
      // Nothing of the dry run is printed for a file that was refused.
      expect(bad.text).not.toContain('conversations in the sample');

      const gone = await run([
        '--sample',
        dir,
        '--dry',
        '--vocabulary',
        join(dir, 'no-such-file.json'),
      ]);
      expect(gone.code).toBe(2);
      expect(gone.text).toContain('cannot read the vocabulary: ENOENT');
    });

    it('answers 2 and the usage when the flag has no file after it', async () => {
      const { code, text } = await run(['--sample', dir, '--vocabulary']);
      expect(code).toBe(2);
      expect(text).toContain('--vocabulary requires a value');
      expect(text).toContain(
        '--sample <dir> [--dry] [--topics] [--vocabulary <file>]',
      );
    });
  });

  it('answers 2 for a sample it cannot read, naming the file and not its content', async () => {
    writeFileSync(
      join(dir, 'transcripts', '004.json'),
      '{"n": 4, "messages": [{"role": "user", "text": "SPOKEN-FOUR"',
    );

    const { code, text } = await run(['--sample', dir, '--dry']);

    expect(code).toBe(2);
    expect(text).toContain(
      'cannot read the sample: transcripts/004.json is not JSON',
    );
    expect(text).not.toContain('SPOKEN');
  });
});

/**
 * A real run, with the database and the model replaced (see the mocks at
 * the top). Three conversations: the person put 1 and 3 under one subject
 * and 2 under another, and called 1 resolved and the other two open.
 *
 * The service is the one that ships (CLEAN-270, the owner's decision of
 * 2026-11-28): with no topic standing it asks no conversation about topics,
 * and it never coins one. So a run without `--vocabulary` measures
 * outcomes only, and a run with it measures the choice from the list and
 * reports a proposal as proposed.
 */
describe('summary calibration, for real', () => {
  let dir: string;
  const origFetch = global.fetch;

  const answer = (over: Record<string, unknown>) =>
    JSON.stringify({
      summary: 'SPOKEN in a summary',
      question: 'SPOKEN as a question?',
      outcome: 'unknown',
      topics: [],
      newTopic: null,
      sentiment: 'neutral',
      language: 'en',
      ...over,
    });

  /**
   * The model, answering each call with the next of `answers`: a text, a
   * status that is not 200, or a text with the `stop_reason` it ended on.
   */
  const model = (
    answers: Array<string | number | { text: string; stop: string }>,
  ) => {
    const queue = [...answers];
    const fetched = jest.fn(async () => {
      const next = queue.shift() ?? '';
      const ok = typeof next !== 'number';
      const text = typeof next === 'object' ? next.text : next;
      return {
        ok,
        status: ok ? 200 : next,
        json: async () => ({
          content: [{ type: 'text', text }],
          ...(typeof next === 'object' ? { stop_reason: next.stop } : {}),
        }),
        text: async () => 'SPOKEN in an error body',
      };
    });
    global.fetch = fetched as unknown as typeof fetch;
    return fetched;
  };

  beforeEach(() => {
    mockConnections.opened = 0;
    mockConnections.closed = 0;
    mockCredentials = [
      {
        id: 'llm-1',
        provider: 'anthropic',
        model: 'claude-x',
        apiKey: 'sk-secret',
        updatedAt: new Date(0),
      },
    ];
    dir = mkdtempSync(join(tmpdir(), 'calibration-real-'));
    mkdirSync(join(dir, 'transcripts'));
    const texts = ['SPOKEN question', 'SPOKEN answer'];
    for (const n of [1, 2, 3]) {
      writeFileSync(
        join(dir, 'transcripts', `00${n}.json`),
        transcript(n, `chat-${n}`, texts),
      );
    }
    writeFileSync(
      join(dir, 'labels.csv'),
      [
        'n,chatId,agent,lastMessageAt,messages,subject,outcome,note',
        '1,chat-1,alpha,x,2,LABELLED password,resolved,',
        '2,chat-2,alpha,x,2,LABELLED invoice,open,',
        '3,chat-3,alpha,x,2,labelled PASSWORD,open,',
      ].join('\n'),
    );
  });
  afterEach(() => {
    global.fetch = origFetch;
    rmSync(dir, { recursive: true, force: true });
  });

  const ANSWERS = [
    answer({
      outcome: 'resolved',
      newTopic: {
        key: 'password-reset',
        labels: { en: 'Password reset', ru: 'Сброс пароля' },
      },
    }),
    answer({
      outcome: 'open',
      newTopic: { key: 'invoices', labels: { en: 'Invoices', ru: 'Счета' } },
    }),
    answer({
      outcome: 'unknown',
      topics: [
        { key: 'password-reset', fit: 'clear' },
        { key: 'invoices', fit: 'loose' },
      ],
    }),
  ];

  it('summarises the sample in order and, with an empty vocabulary, prints the outcomes only', async () => {
    const fetched = model(ANSWERS);

    const { code, printed, text } = await run(['--sample', dir]);

    expect(code).toBe(0);
    expect(fetched).toHaveBeenCalledTimes(3);
    for (const args of printed) expect(args).toHaveLength(1);
    expect(text).toContain(
      'summary calibration: prompt version 2, model claude-x',
    );
    expect(text).toContain('conversations in the sample: 3; summarised: 3');
    // No pairs: a pair is of topics, and none was asked for.
    expect(text).toContain('scored: 3 conversations\n');
    expect(text).toContain('[5] open, precision (target 80%): 100.0% (1 of 1)');
    expect(text).toContain('[6] open, recall: 50.0% (1 of 2)');
    expect(text).toContain('[7] resolved, precision: 100.0% (1 of 1)');
    expect(text).toContain('[8] resolved, recall: 100.0% (1 of 1)');
    expect(text).toContain('open by the person, not by the model: 3');
    // Nothing failed, so the headline number says where it stands.
    expect(text).toContain(
      '(target 80%): 100.0% (1 of 1); failed, in no share: 0.0% (0 of 3); meets the target',
    );
  });

  // The answers above propose topics and name keys all the same: nothing is
  // read from them about topics, because the prompt asked for none.
  it('says that topics are not asked while the vocabulary is empty, and prints no topic number', async () => {
    model(ANSWERS);

    const { printed, text } = await run(['--sample', dir]);

    const lines = printed.map((args) => args[0] as string);
    const at = lines.indexOf('Topics (judgment 1): not asked');
    expect(at).toBeGreaterThan(-1);
    expect(lines.slice(at + 1, at + 6)).toEqual([
      'The vocabulary is empty, and while it is no conversation is asked about',
      'topics and no topic is coined (CLEAN-270, the decision of 2026-11-28 in',
      'contracts/summary-judgments.md). This run measures outcomes only: it has',
      'no topic number to print. Give it a list with --vocabulary <file> to',
      'measure the choice from that list.',
    ]);
    for (const mark of ['[1]', '[2]', '[3]', '[4]', '[9]', '[10]']) {
      expect(text).not.toContain(mark);
    }
    expect(text).not.toMatch(/pairs|second half|proposed|common topic/);
  });

  it('asks no conversation about topics: every prompt is the one with two questions and no list', async () => {
    const fetched = model(ANSWERS);

    await run(['--sample', dir]);

    const prompts = (
      fetched.mock.calls as unknown as Array<[unknown, { body: string }]>
    ).map(
      ([, init]) =>
        (JSON.parse(init.body) as { messages: Array<{ content: string }> })
          .messages[0].content,
    );
    expect(prompts).toHaveLength(3);
    for (const prompt of prompts) {
      expect(prompt).toContain('answer two questions about the conversation');
      expect(prompt).not.toMatch(/topic/i);
      expect(prompt).not.toContain('(none yet)');
      // Nothing an earlier conversation proposed reaches a later one.
      expect(prompt).not.toMatch(/password-reset|invoices/);
    }
  });

  it('prints nothing of what was said, what the labeller wrote or what the model answered', async () => {
    model(ANSWERS);
    const { text } = await run(['--sample', dir]);
    expect(text).not.toMatch(
      /SPOKEN|LABELLED|password|PASSWORD|invoice|Invoices|sk-secret/,
    );
  });

  // With an empty vocabulary there is no topic of the run to list: no
  // conversation was asked about one. Said, not printed as an empty list.
  describe('with --topics', () => {
    it('has no topics to list while the vocabulary is empty, and says so after the report', async () => {
      model(ANSWERS);

      const { code, printed, text } = await run(['--sample', dir, '--topics']);

      expect(code).toBe(0);
      for (const args of printed) expect(args).toHaveLength(1);
      const lines = printed.map((args) => args[0] as string);
      expect(lines[lines.length - 1]).toBe(
        '--topics: nothing to list, no conversation is asked about topics while the vocabulary is empty.',
      );
      expect(text).not.toContain('Topics of the run');
      // What the answers proposed all the same is printed nowhere.
      expect(text).not.toMatch(/password-reset|Password reset|invoices/);
      expect(text).not.toMatch(/SPOKEN|LABELLED|PASSWORD|sk-secret/);
    });

    it('is off unless asked for: the report alone names no topic', async () => {
      model(ANSWERS);
      const { text } = await run(['--sample', dir]);
      expect(text).not.toContain('Topics of the run');
      expect(text).not.toMatch(/password-reset|Password reset/);
    });
  });

  // The judgment as the contract states it: a choice from a list. The run
  // starts with two topics, each standing for one subject of the reference:
  // 1 and 3 are labelled with the subject of `account-access`, 2 with that
  // of `invoices`.
  describe('with --vocabulary', () => {
    let file: string;
    const SEEDED = [
      {
        key: 'account-access',
        labels: { en: 'Account access', ru: 'Доступ' },
        subject: 'LABELLED password',
      },
      {
        key: 'invoices',
        labels: { en: 'Invoices', ru: 'Счета' },
        subject: 'LABELLED invoice',
      },
    ];
    // 1 chose the topic of its subject. 2 proposed one although its subject
    // has one in the list. 3 chose from the list, and chose the other.
    const CHOSEN = [
      answer({
        outcome: 'resolved',
        topics: [{ key: 'account-access', fit: 'clear' }],
      }),
      answer({
        outcome: 'open',
        newTopic: {
          key: 'payments',
          labels: { en: 'Payments', ru: 'Платежи' },
        },
      }),
      answer({ outcome: 'open', topics: [{ key: 'invoices', fit: 'clear' }] }),
    ];
    const prompts = (fetched: jest.Mock) =>
      (fetched.mock.calls as unknown as Array<[unknown, { body: string }]>).map(
        ([, init]) =>
          (JSON.parse(init.body) as { messages: Array<{ content: string }> })
            .messages[0].content,
      );

    beforeEach(() => {
      file = join(dir, 'vocabulary.json');
      writeFileSync(file, JSON.stringify(SEEDED));
    });

    it('prints, before the pairs, how many conversations were stored with the topic of their subject', async () => {
      model(CHOSEN);

      const { code, printed } = await run([
        '--sample',
        dir,
        '--vocabulary',
        file,
      ]);

      expect(code).toBe(0);
      for (const args of printed) expect(args).toHaveLength(1);
      const lines = printed.map((args) => args[0] as string);
      const at = lines.indexOf(
        'Topics, chosen from a given list (judgment 1 as the contract states it)',
      );
      expect(at).toBeGreaterThan(-1);
      expect(lines.indexOf('Topics (judgment 1)')).toBeGreaterThan(at);
      expect(lines.slice(at + 7, lines.indexOf('Topics (judgment 1)'))).toEqual(
        [
          '  [9] chosen as the reference chose (target 90%): 33.3% (1 of 3); failed, in no share: 0.0% (0 of 3); under the target',
          '      of the 1 chosen so, stored with a second topic besides: 0',
          '      of the 2 not chosen so: another seeded topic 1, no topic 0, a new topic proposed and not coined in this release 1',
          '  [10] topics proposed although a list was given, not coined in this release: 1 in 3 conversations, 33.3 per 100',
          '      reference subject not in the list, in no share: 0',
          '      no subject by the reference: left without a topic by the model too 0, given a topic 0',
          '  [9] second half (2 scored): chosen as the reference chose: 0.0% (0 of 2)',
          '  not chosen as the reference chose, as "conversation -> the model\'s keys (the reference\'s key)": 2',
          '    2 -> no topic, proposed payments (invoices)',
          '    3 -> invoices (account-access)',
          '',
        ],
      );
      // The pairs are printed as before, under the labels of the recorded
      // runs, with what was proposed where those say "coined".
      const text = lines.join('\n');
      expect(text).toContain('scored: 3 conversations, 3 pairs');
      expect(text).toContain(
        '[4] topics proposed, not coined in this release: 1 in 3 conversations, 33.3 per 100',
      );
      expect(text).toContain(
        '[4] second half: topics proposed, not coined in this release: 1 in 2 conversations, 50.0 per 100',
      );
      expect(text).toContain('[5] open, precision (target 80%)');
      expect(text).not.toContain('not asked');
    });

    // What a conversation proposed is no topic: the next one is offered the
    // list the run was given, and is stored with what it chose from it.
    it('coins nothing: a proposal reaches no later prompt, and a key proposed twice is counted once', async () => {
      const fetched = model([CHOSEN[1], CHOSEN[1], CHOSEN[2]]);

      const { text } = await run(['--sample', dir, '--vocabulary', file]);

      for (const prompt of prompts(fetched)) {
        expect(prompt).toContain(
          '- account-access: Account access\n- invoices: Invoices\n',
        );
        expect(prompt).not.toContain('payments');
      }
      // 1 and 2 proposed the same key: one new topic, proposed twice.
      expect(text).toContain(
        '[10] topics proposed although a list was given, not coined in this release: 1 in 3 conversations, 33.3 per 100',
      );
      expect(text).toContain(
        'of the 3 not chosen so: another seeded topic 1, no topic 0, a new topic proposed and not coined in this release 2',
      );
      // The key was first proposed in the first half: none is new in the second.
      expect(text).toContain(
        '[4] second half: topics proposed, not coined in this release: 0 in 2 conversations, 0.0 per 100',
      );
    });

    it('lists every seeded topic in the first prompt, in the order of the file, and never its subject', async () => {
      const fetched = model(CHOSEN);

      await run(['--sample', dir, '--vocabulary', file]);

      const sent = prompts(fetched);
      expect(sent).toHaveLength(3);
      expect(sent[0]).toContain(
        '- account-access: Account access\n- invoices: Invoices\n',
      );
      expect(sent[0]).not.toContain('(none yet)');
      // What 2 proposed is not a topic, and is not offered to 3.
      expect(sent[2]).not.toContain('payments');
      for (const prompt of sent) {
        expect(prompt).not.toMatch(/LABELLED|password|invoice\b/i);
      }
    });

    it('prints keys and numbers: nothing said, nothing the reference wrote, no label of another language', async () => {
      model(CHOSEN);
      const { text } = await run(['--sample', dir, '--vocabulary', file]);
      expect(text).not.toMatch(/SPOKEN|LABELLED|password|PASSWORD|sk-secret/);
      expect(text).not.toMatch(/Доступ|Счета|Платежи|Account access|Payments/);
    });

    // Nothing was stored for it: it is in no share, and beside the number.
    it('leaves a conversation the model failed on out of every count of the section', async () => {
      model([CHOSEN[0], 'SPOKEN where JSON should be', CHOSEN[2]]);

      const { code, text } = await run(['--sample', dir, '--vocabulary', file]);

      expect(code).toBe(1);
      expect(text).toContain(
        '[9] chosen as the reference chose (target 90%): 50.0% (1 of 2); failed, in no share: 33.3% (1 of 3); no verdict: more than 10% of the sample failed',
      );
      expect(text).toContain(
        'of the 1 not chosen so: another seeded topic 1, no topic 0, a new topic proposed and not coined in this release 0',
      );
      expect(text).toContain(
        '[10] topics proposed although a list was given, not coined in this release: 0 in 2 conversations, 0.0 per 100',
      );
      expect(text).toContain('    3 -> invoices (account-access)');
      expect(text).not.toContain('    2 -> ');
    });

    // A summary that reads the list back is an unusable answer of its own
    // kind (CLEAN-270, security review): the report names it, from the
    // service's list of reasons, and quotes neither the summary nor a key.
    it('names an answer that repeats the topic list, and quotes none of it', async () => {
      const three = ['aa', 'ab', 'ac'].map((name) => ({
        key: `topic-${name}`,
        labels: { en: `Topic ${name}`, ru: `Тема ${name}` },
        subject: `LABELLED ${name}`,
      }));
      writeFileSync(file, JSON.stringify(three));
      model([
        answer({ summary: 'SPOKEN, then: topic-aa, topic-ab, topic-ac' }),
        answer({}),
        answer({}),
      ]);

      const { code, text } = await run(['--sample', dir, '--vocabulary', file]);

      expect(code).toBe(1);
      expect(text).toContain('summarised: 2; failed: 1 (n: 1)');
      expect(text).toContain(
        'failed 1: the answer could not be used (repeats the topic list)',
      );
      expect(text).not.toMatch(/SPOKEN|topic-a[abc], /);
    });

    // The service's own rule: an offered topic is stored as a clear fit or
    // not at all, so naming its key again as a new topic stores nothing. Nor
    // is that a new topic proposed: the key is a topic of the list.
    it('counts a conversation left without a topic, a loose fit included, as a miss to none', async () => {
      model([
        answer({ topics: [{ key: 'account-access', fit: 'loose' }] }),
        answer({
          newTopic: { key: 'invoices', labels: { en: 'Bills', ru: 'Счета' } },
        }),
        answer({}),
      ]);

      const { text } = await run(['--sample', dir, '--vocabulary', file]);

      expect(text).toContain(
        '[9] chosen as the reference chose (target 90%): 0.0% (0 of 3)',
      );
      expect(text).toContain(
        'of the 3 not chosen so: another seeded topic 0, no topic 3, a new topic proposed and not coined in this release 0',
      );
      expect(text).toContain('    1 -> no topic (account-access)');
      expect(text).toContain('    2 -> no topic (invoices)');
      expect(text).toContain('    3 -> no topic (account-access)');
      expect(text).toContain(
        '[10] topics proposed although a list was given, not coined in this release: 0 in 3 conversations, 0.0 per 100',
      );
    });

    it('lists the seeded topics as the topics of the run, then what was proposed and not coined, with --topics', async () => {
      model(CHOSEN);

      const { printed } = await run([
        '--sample',
        dir,
        '--vocabulary',
        file,
        '--topics',
      ]);

      const lines = printed.map((args) => args[0] as string);
      const at = lines.findIndex((line) =>
        line.startsWith('Topics of the run (--topics): 2 standing'),
      );
      expect(lines.slice(at + 1)).toEqual([
        '  account-access (Account access): 1 (n: 1)',
        '  invoices (Invoices): 1 (n: 3)',
        '  no topic: 1 (n: 2)',
        'Proposed as new topics, not coined in this release (--topics): 1 keys, as "key: conversations that proposed it"',
        '  payments: 1 (n: 2)',
      ]);
    });

    // A prompt lists the sixty most used topics. The recorded runs coined
    // on the way, and the sixty-first topic pushed a seeded one out of the
    // list. Nothing is coined now: sixty seeded stay sixty, whatever a
    // conversation proposes, and every prompt lists all of them.
    it('offers every conversation the whole list, whatever the ones before it proposed', async () => {
      const letters = 'abcdefghijklmnopqrstuvwxyz';
      const sixty = Array.from({ length: 60 }, (_, i) => {
        const name = `${letters[Math.floor(i / 26)]}${letters[i % 26]}`;
        return {
          key: `topic-${name}`,
          labels: { en: `Topic ${name}`, ru: `Тема ${name}` },
          subject: `LABELLED ${name}`,
        };
      });
      writeFileSync(file, JSON.stringify(sixty));
      const fetched = model([CHOSEN[1], answer({}), answer({})]);

      const { text } = await run(['--sample', dir, '--vocabulary', file]);

      const sent = prompts(fetched);
      for (const prompt of sent) {
        expect(prompt).toContain('- topic-ch: Topic ch\n');
        expect(prompt).not.toContain('payments');
      }
      expect(text).not.toContain('not offered the whole list');
      // No label of the sample is a subject of this file: nothing to share.
      expect(text).toContain(
        '[9] chosen as the reference chose (target 90%): n/a (0 of 0)',
      );
      expect(text).toContain(
        'reference subject not in the list, in no share: 3 (n: 1, 2, 3)',
      );
    });

    it('answers 2 for a file it cannot read, before the database and the model', async () => {
      writeFileSync(file, JSON.stringify([SEEDED[0], SEEDED[0]]));
      const fetched = model(CHOSEN);

      const { code, text } = await run(['--sample', dir, '--vocabulary', file]);

      expect(code).toBe(2);
      expect(text).toBe(
        'cannot read the vocabulary: the vocabulary file: entry 2 ("account-access") repeats the key of entry 1',
      );
      expect(fetched).not.toHaveBeenCalled();
      expect(mockConnections.opened).toBe(0);
    });
  });

  it('opens the database for the credential, closes it, and never starts the batch', async () => {
    jest.useFakeTimers();
    try {
      model(ANSWERS);
      await run(['--sample', dir]);
      expect(mockConnections).toEqual({ opened: 1, closed: 1 });
      // No interval of the summary batch was left running.
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('says so, and calls nothing, when the database has no active Anthropic credential', async () => {
    mockCredentials = [{ id: 'llm-2', provider: 'openai', apiKey: 'sk' }];
    const fetched = model(ANSWERS);

    const { code, text } = await run(['--sample', dir]);

    expect(code).toBe(1);
    expect(text).toContain('no active Anthropic credential');
    expect(fetched).not.toHaveBeenCalled();
    expect(mockConnections.closed).toBe(1);
  });

  it('counts an answer it cannot read as failed, by its number, without quoting it', async () => {
    model([
      ANSWERS[0],
      'SPOKEN where JSON should be',
      answer({ outcome: 'open' }),
    ]);

    const { code, text } = await run(['--sample', dir]);

    expect(code).toBe(1);
    expect(text).toContain('summarised: 2; failed: 1 (n: 2)');
    expect(text).toContain(
      'failed 2: the answer could not be used (no JSON object)',
    );
    expect(text).toContain('scored: 2 conversations\n');
    expect(text).not.toContain('SPOKEN');
    // One of three failed: the shares are over the two that did not, and
    // no number is said to meet its target.
    expect(text).toContain(
      '(target 80%): 100.0% (1 of 1); failed, in no share: 33.3% (1 of 3); no verdict: more than 10% of the sample failed',
    );
    expect(text).not.toContain('meets the target');
  });

  // How the answer ended is a failure of its own kind (CLEAN-270): a report
  // that said "no JSON object" of an answer cut at the token limit would
  // send its reader to the prompt, when the limit is what to look at.
  it('names an answer cut at the token limit and one the model declined, and quotes neither', async () => {
    model([
      { text: '{"summary":"SPOKEN and then cut', stop: 'max_tokens' },
      ANSWERS[1],
      { text: 'SPOKEN in declining', stop: 'refusal' },
    ]);

    const { code, text } = await run(['--sample', dir]);

    expect(code).toBe(1);
    expect(text).toContain('summarised: 1; failed: 2 (n: 1, 3)');
    expect(text).toContain(
      'failed 1: the answer could not be used (cut at the token limit)',
    );
    expect(text).toContain(
      'failed 3: the answer could not be used (declined by the model)',
    );
    expect(text).not.toContain('SPOKEN');
  });

  it('stops at a credential the provider rejects', async () => {
    const fetched = model([401, ANSWERS[1], ANSWERS[2]]);

    const { code, text } = await run(['--sample', dir]);

    expect(code).toBe(1);
    expect(fetched).toHaveBeenCalledTimes(1);
    expect(text).toContain('failed 1: the provider rejected the credential');
    expect(text).toContain('summarised: 0');
    expect(text).not.toContain('SPOKEN');
  });

  it('goes on after a failure of the provider, and names only its status', async () => {
    model([529, ANSWERS[1], ANSWERS[2]]);

    const { text } = await run(['--sample', dir]);

    expect(text).toContain(
      'failed 1: Anthropic API 529: the provider did not answer',
    );
    expect(text).toContain('summarised: 2');
    expect(text).not.toContain('SPOKEN');
  });
});
