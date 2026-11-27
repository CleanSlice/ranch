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
    expect(text).toMatch(/prompts built: 3, with an empty vocabulary/);
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

  it('summarises the sample in order and prints the eight numbers', async () => {
    const fetched = model(ANSWERS);

    const { code, printed, text } = await run(['--sample', dir]);

    expect(code).toBe(0);
    expect(fetched).toHaveBeenCalledTimes(3);
    for (const args of printed) expect(args).toHaveLength(1);
    expect(text).toContain(
      'summary calibration: prompt version 2, model claude-x',
    );
    expect(text).toContain('conversations in the sample: 3; summarised: 3');
    expect(text).toContain('scored: 3 conversations, 3 pairs');
    // 1 and 3 are one subject and got one topic; 2 got another.
    expect(text).toContain('(target 90%): 100.0% (1 of 1)');
    expect(text).toContain('same or different: 100.0% (3 of 3)');
    expect(text).toContain(
      '[2] clear fits the person agrees with: 100.0% (1 of 1)',
    );
    // 3 touched the topic of 2 loosely, and the person called them apart.
    expect(text).toContain(
      '[3] loose fits the person agrees with: 0.0% (0 of 1)',
    );
    expect(text).toContain(
      '[4] topics coined: 2 in 3 conversations, 66.7 per 100',
    );
    expect(text).toContain('[5] open, precision (target 80%): 100.0% (1 of 1)');
    expect(text).toContain('[6] open, recall: 50.0% (1 of 2)');
    expect(text).toContain('[7] resolved, precision: 100.0% (1 of 1)');
    expect(text).toContain('[8] resolved, recall: 100.0% (1 of 1)');
    expect(text).toContain('open by the person, not by the model: 3');
    // Nothing failed, so each headline number says where it stands.
    expect(text).toContain(
      '(target 90%): 100.0% (1 of 1); failed, in no share: 0.0% (0 of 3); meets the target',
    );
    expect(text).toContain(
      '(target 80%): 100.0% (1 of 1); failed, in no share: 0.0% (0 of 3); meets the target',
    );
  });

  // The first conversation of a run is offered nothing and has to propose.
  // The second half is 2 and 3 here: 2 coined a topic, 3 chose among two.
  it('prints the topic numbers again for the second half of the sample, in file order', async () => {
    model(ANSWERS);

    const { text } = await run(['--sample', dir]);

    expect(text).toContain(
      'second half of the sample only: the last 2 of 3 conversations in file order; 2 summarised, 2 scored, 1 pairs',
    );
    // 2 and 3 are two subjects and got two topics.
    expect(text).toContain(
      'second half (2 scored): pairs the two agree on, same or different: 100.0% (1 of 1)',
    );
    expect(text).toContain(
      '[1] second half (2 scored): same-subject pairs that got the same topic: n/a (0 of 0)',
    );
    expect(text).toContain(
      '[3] second half (2 scored): loose fits the person agrees with: 0.0% (0 of 1)',
    );
    expect(text).toContain(
      '[4] second half: topics coined: 1 in 2 conversations, 50.0 per 100',
    );
  });

  it('offers each conversation the topics the ones before it coined', async () => {
    const fetched = model(ANSWERS);

    await run(['--sample', dir]);

    const prompts = (
      fetched.mock.calls as unknown as Array<[unknown, { body: string }]>
    ).map(
      ([, init]) =>
        (JSON.parse(init.body) as { messages: Array<{ content: string }> })
          .messages[0].content,
    );
    expect(prompts[0]).toContain('(none yet)');
    expect(prompts[1]).toContain('- password-reset: Password reset');
    expect(prompts[2]).toContain('- invoices: Invoices');
  });

  it('prints nothing of what was said, what the labeller wrote or what the model answered', async () => {
    model(ANSWERS);
    const { text } = await run(['--sample', dir]);
    expect(text).not.toMatch(
      /SPOKEN|LABELLED|password|PASSWORD|invoice|Invoices|sk-secret/,
    );
  });

  // Reading a miss needs the topics the model made (`--topics`). Conversation
  // 1 coined a topic and 3 chose it; 2 coined another, which 3 only touched.
  describe('with --topics', () => {
    it('lists the topics of the run after the report: key, English label, conversations', async () => {
      model(ANSWERS);

      const { code, printed, text } = await run(['--sample', dir, '--topics']);

      expect(code).toBe(0);
      for (const args of printed) expect(args).toHaveLength(1);
      const lines = printed.map((args) => args[0] as string);
      const at = lines.findIndex((line) =>
        line.startsWith('Topics of the run (--topics): 2 standing'),
      );
      // After everything the report prints, and the last thing printed.
      expect(at).toBeGreaterThan(
        lines.findIndex((line) =>
          line.includes('a common topic, two subjects'),
        ),
      );
      expect(lines.slice(at + 1)).toEqual([
        '  password-reset (Password reset): 2 (n: 1, 3)',
        // A loose fit is not stored: 3 is not listed with it.
        '  invoices (Invoices): 1 (n: 2)',
        '  no topic: 0',
      ]);
      // The report above it is the one printed without the flag.
      expect(text).toContain(
        '[4] topics coined: 2 in 3 conversations, 66.7 per 100',
      );
    });

    it('prints the vocabulary and nothing else of a conversation', async () => {
      model(ANSWERS);
      const { text } = await run(['--sample', dir, '--topics']);
      // Not what was said, the summary or the question (SPOKEN), not what
      // the labeller wrote (LABELLED, PASSWORD), not the credential, and of
      // a topic not the label of another language.
      expect(text).not.toMatch(/SPOKEN|LABELLED|PASSWORD|sk-secret/);
      expect(text).not.toMatch(/Сброс|Счета/);
    });

    it('lists a conversation stored with no topic, and leaves out one that failed', async () => {
      model([
        ANSWERS[0],
        answer({ outcome: 'open' }),
        'SPOKEN where JSON should be',
      ]);

      const { code, printed } = await run(['--sample', dir, '--topics']);

      expect(code).toBe(1);
      const lines = printed.map((args) => args[0] as string);
      const at = lines.findIndex((line) =>
        line.startsWith('Topics of the run (--topics): 1 standing'),
      );
      expect(lines.slice(at + 1)).toEqual([
        '  password-reset (Password reset): 1 (n: 1)',
        '  no topic: 1 (n: 2)',
      ]);
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
    // 1 chose the topic of its subject. 2 coined one although its subject
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
          '      of the 2 not chosen so: another seeded topic 1, no topic 0, a topic coined in the run 1',
          '  [10] topics coined although a list was given: 1 in 3 conversations, 33.3 per 100',
          '      reference subject not in the list, in no share: 0',
          '      no subject by the reference: left without a topic by the model too 0, given a topic 0',
          '  [9] second half (2 scored): chosen as the reference chose: 0.0% (0 of 2)',
          '  not chosen as the reference chose, as "conversation -> the model\'s keys (the reference\'s key)": 2',
          '    2 -> payments (invoices)',
          '    3 -> invoices (account-access)',
          '',
        ],
      );
      // The pairs are printed as before, and a seeded topic is not coined.
      const text = lines.join('\n');
      expect(text).toContain(
        '[4] topics coined: 1 in 3 conversations, 33.3 per 100',
      );
      expect(text).toContain(
        '[4] second half: topics coined: 1 in 2 conversations, 50.0 per 100',
      );
      expect(text).toContain('[5] open, precision (target 80%)');
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
      // What 2 coined is offered to 3, after the topics in use.
      expect(sent[2]).toContain('- payments: Payments');
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
        'of the 1 not chosen so: another seeded topic 1, no topic 0, a topic coined in the run 0',
      );
      expect(text).toContain(
        '[10] topics coined although a list was given: 0 in 2 conversations, 0.0 per 100',
      );
      expect(text).toContain('    3 -> invoices (account-access)');
      expect(text).not.toContain('    2 -> ');
    });

    // The service's own rule: an offered topic is stored as a clear fit or
    // not at all, so naming its key again as a new topic stores nothing.
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
        'of the 3 not chosen so: another seeded topic 0, no topic 3, a topic coined in the run 0',
      );
      expect(text).toContain('    1 -> no topic (account-access)');
      expect(text).toContain('    2 -> no topic (invoices)');
      expect(text).toContain('    3 -> no topic (account-access)');
      expect(text).toContain(
        '[10] topics coined although a list was given: 0 in 3 conversations, 0.0 per 100',
      );
    });

    it('lists the seeded topics among the topics of the run, with --topics', async () => {
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
        line.startsWith('Topics of the run (--topics): 3 standing'),
      );
      expect(lines.slice(at + 1)).toEqual([
        '  account-access (Account access): 1 (n: 1)',
        '  invoices (Invoices): 1 (n: 3)',
        '  payments (Payments): 1 (n: 2)',
        '  no topic: 0',
      ]);
    });

    // A prompt lists the sixty most used topics. Sixty seeded and one coined
    // by conversation 1 are sixty-one: from then on the last seeded topic,
    // which nobody used, is not in the list, and the report says for whom.
    it('names the conversations that were not offered the whole list', async () => {
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
      expect(sent[0]).toContain('- topic-ch: Topic ch\n');
      expect(sent[1]).toContain('- payments: Payments\n');
      expect(sent[1]).not.toContain('- topic-ch: Topic ch\n');
      expect(text).toContain(
        '  note: 2 conversations were not offered the whole list (n: 2, 3): a prompt lists the 60 most used topics, and with the ones coined on the way more than that stood.',
      );
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
    model([ANSWERS[0], 'SPOKEN where JSON should be', ANSWERS[2]]);

    const { code, text } = await run(['--sample', dir]);

    expect(code).toBe(1);
    expect(text).toContain('summarised: 2; failed: 1 (n: 2)');
    expect(text).toContain(
      'failed 2: the answer could not be used (no JSON object)',
    );
    expect(text).toContain('scored: 2 conversations, 1 pairs');
    expect(text).not.toContain('SPOKEN');
    // One of three failed: the shares are over the two that did not, and
    // no number is said to meet its target.
    expect(text).toContain(
      '(target 90%): 100.0% (1 of 1); failed, in no share: 33.3% (1 of 3); no verdict: more than 10% of the sample failed',
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
