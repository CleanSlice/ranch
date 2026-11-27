import {
  parseCalibrationArgs,
  parseCsv,
  parseTranscript,
  parseVocabulary,
  readLabels,
  sameSubject,
  seedKeyOf,
} from './sample';

const BOM = '\uFEFF';
const HEADER = 'n,chatId,agent,lastMessageAt,messages,subject,outcome,note';

/** A labels file as the labeller's spreadsheet saves it: BOM, CRLF, quoted. */
const csv = (...rows: string[]) =>
  BOM + [HEADER, ...rows].join('\r\n') + '\r\n';

describe('parseCalibrationArgs', () => {
  it('takes the sample directory, and runs for real unless told otherwise', () => {
    expect(parseCalibrationArgs(['--sample', 'D:/cal'])).toEqual({
      sample: 'D:/cal',
      dry: false,
      topics: false,
    });
    expect(parseCalibrationArgs(['--dry', '--sample', 'D:/cal'])).toEqual({
      sample: 'D:/cal',
      dry: true,
      topics: false,
    });
  });

  // The topics of a run are printed only when asked for: without the flag
  // a report names no topic at all.
  it('lists the topics of the run only when --topics is given', () => {
    expect(parseCalibrationArgs(['--sample', 'D:/cal', '--topics'])).toEqual({
      sample: 'D:/cal',
      dry: false,
      topics: true,
    });
    expect(
      parseCalibrationArgs(['--topics', '--sample', 'D:/cal']).topics,
    ).toBe(true);
  });

  it('refuses a run with no sample, a flag with no value and a flag it does not know', () => {
    expect(() => parseCalibrationArgs([])).toThrow(
      '--sample <dir> is required',
    );
    expect(() => parseCalibrationArgs(['--sample'])).toThrow(
      '--sample requires a value',
    );
    expect(() => parseCalibrationArgs(['--sample', '--dry'])).toThrow(
      '--sample requires a value',
    );
    expect(() => parseCalibrationArgs(['--sample', 'x', '--write'])).toThrow(
      'unknown flag --write',
    );
  });

  // The run is given its topics only when asked: without the flag the
  // arguments are what they were, and the vocabulary starts empty.
  it('takes the file of the topics a run starts with, when --vocabulary names one', () => {
    expect(
      parseCalibrationArgs(['--sample', 'D:/cal', '--vocabulary', 'D:/v.json']),
    ).toEqual({
      sample: 'D:/cal',
      dry: false,
      topics: false,
      vocabulary: 'D:/v.json',
    });
    expect(
      parseCalibrationArgs(['--vocabulary', 'v.json', '--dry', '--sample', 'x'])
        .vocabulary,
    ).toBe('v.json');
    expect('vocabulary' in parseCalibrationArgs(['--sample', 'x'])).toBe(false);
  });

  it('refuses --vocabulary with no file after it', () => {
    expect(() =>
      parseCalibrationArgs(['--sample', 'x', '--vocabulary']),
    ).toThrow('--vocabulary requires a value');
    expect(() =>
      parseCalibrationArgs(['--vocabulary', '--sample', 'x']),
    ).toThrow('--vocabulary requires a value');
  });
});

/**
 * The topics a run is given (`--vocabulary`). The file is written by hand,
 * and its `subject` is the reference's wording of what conversations are
 * about: a refusal names the entry by its number and at most its key.
 */
describe('parseVocabulary', () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    key: 'billing',
    labels: { en: 'Billing', ru: 'Оплата' },
    subject: 'SUBJECT оплата',
    ...over,
  });
  const file = (...entries: unknown[]) => JSON.stringify(entries);
  const refused = (content: string): string => {
    try {
      parseVocabulary(content);
    } catch (err) {
      return (err as Error).message;
    }
    return 'not refused';
  };

  it('reads the topics in the order of the file: key, labels, subject', () => {
    expect(
      parseVocabulary(
        file(
          entry(),
          entry({
            key: 'agent-setup',
            labels: { en: 'Agent setup', ru: 'Настройка агента' },
            subject: 'SUBJECT настройка',
          }),
        ),
      ),
    ).toEqual([
      {
        key: 'billing',
        labels: { en: 'Billing', ru: 'Оплата' },
        subject: 'SUBJECT оплата',
      },
      {
        key: 'agent-setup',
        labels: { en: 'Agent setup', ru: 'Настройка агента' },
        subject: 'SUBJECT настройка',
      },
    ]);
  });

  it('reads a file saved with a BOM, and puts a label and a subject on one line', () => {
    const [topic] = parseVocabulary(
      BOM +
        file(
          entry({
            labels: {
              en: ' Billing\n and  more ',
              ru: 'Оплата',
              de: 'Zahlung',
            },
            subject: '  SUBJECT   оплата ',
          }),
        ),
    );
    // A label in a language the console does not have is not kept.
    expect(topic.labels).toEqual({ en: 'Billing and more', ru: 'Оплата' });
    expect(topic.subject).toBe('SUBJECT оплата');
  });

  it('refuses what is not a list of topics', () => {
    expect(refused('[{"key": ')).toBe('the vocabulary file is not JSON');
    expect(refused('{"key": "billing"}')).toBe(
      'the vocabulary file is not a list of { "key", "labels", "subject" } entries',
    );
    expect(refused('[]')).toBe('the vocabulary file lists no topic');
    expect(refused(file(entry(), 'SUBJECT as a string'))).toBe(
      'the vocabulary file: entry 2 is not an object',
    );
  });

  // The key is listed in the prompt as written, and the parser matches the
  // model's answer to it letter by letter: the form it is stored in, or none.
  it.each([
    ['in capitals', 'Billing'],
    ['of two words with a blank', 'order refunds'],
    ['with a digit', 'tier2'],
    ['with a doubled dash', 'order--refunds'],
    ['in another script', 'оплата'],
    ['of forty-one letters', 'a'.repeat(41)],
    ['that is empty', ''],
    ['that is a number', 7],
    ['that is missing', undefined],
  ])('refuses a key %s, by the number of its entry', (_name, key) => {
    const message = refused(file(entry(), entry({ key, subject: 'other' })));
    expect(message).toBe(
      'the vocabulary file: entry 2 has no key the summary would store as written: ' +
        'lower-case words joined by single dashes, 40 characters at most',
    );
  });

  it('takes a key as long as a key may be, and of several words', () => {
    const long = `${'a'.repeat(19)}-${'b'.repeat(20)}`;
    expect(parseVocabulary(file(entry({ key: long })))[0].key).toBe(long);
    expect(
      parseVocabulary(file(entry({ key: 'order-refunds-late' })))[0].key,
    ).toBe('order-refunds-late');
  });

  it('refuses a key given twice, naming both entries', () => {
    expect(
      refused(
        file(
          entry(),
          entry({ key: 'refunds', subject: 'b' }),
          entry({ subject: 'c' }),
        ),
      ),
    ).toBe(
      'the vocabulary file: entry 3 ("billing") repeats the key of entry 1',
    );
  });

  it('refuses an entry without a label in every console language', () => {
    expect(refused(file(entry({ labels: { en: 'Billing' } })))).toBe(
      'the vocabulary file: entry 1 ("billing") has no label in: ru',
    );
    expect(refused(file(entry({ labels: { en: '  ', ru: 7 } })))).toBe(
      'the vocabulary file: entry 1 ("billing") has no label in: en, ru',
    );
    expect(refused(file(entry({ labels: undefined })))).toBe(
      'the vocabulary file: entry 1 ("billing") has no label in: en, ru',
    );
  });

  it('refuses an entry without a subject, and a subject given twice', () => {
    expect(refused(file(entry({ subject: '  ' })))).toBe(
      'the vocabulary file: entry 1 ("billing") has no subject',
    );
    expect(refused(file(entry({ subject: undefined })))).toBe(
      'the vocabulary file: entry 1 ("billing") has no subject',
    );
    // The same words, as two labels are compared: case and spacing apart.
    expect(
      refused(
        file(entry(), entry({ key: 'refunds', subject: ' subject  ОПЛАТА' })),
      ),
    ).toBe(
      'the vocabulary file: entry 2 ("refunds") has the subject of entry 1 ("billing")',
    );
  });

  // Every topic of the file has to be in the prompt: what is not offered
  // cannot be chosen, and the run measures a choice from the whole list.
  it('takes as many topics as a prompt offers, and refuses one more', () => {
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const many = (count: number) =>
      file(
        ...Array.from({ length: count }, (_, i) => {
          const name = `${letters[Math.floor(i / 26)]}${letters[i % 26]}`;
          return entry({ key: `topic-${name}`, subject: `subject ${name}` });
        }),
      );
    expect(parseVocabulary(many(60))).toHaveLength(60);
    expect(refused(many(61))).toBe(
      'the vocabulary file lists 61 topics: a prompt offers 60 at most ' +
        '(VOCABULARY_CAP), and a topic that is not offered cannot be chosen',
    );
  });

  it('never quotes a subject, a label or a key that is not one', () => {
    const messages = [
      refused(file(entry(), entry({ key: 'SUBJECT in the key field' }))),
      refused(file(entry(), entry({ key: 'refunds', labels: 'SUBJECT' }))),
      refused(file(entry(), entry({ key: 'refunds' }))),
      refused(file(entry(), 'SUBJECT')),
      refused(`[${JSON.stringify(entry())}, SUBJECT`),
    ];
    for (const message of messages) {
      expect(message).toMatch(/^the vocabulary file/);
      expect(message).not.toMatch(/SUBJECT|оплата|Оплата|Billing/);
    }
  });
});

describe('seedKeyOf', () => {
  const SEED = [
    { key: 'billing', subject: 'Оплата счёта' },
    { key: 'agent-setup', subject: 'настройка агента' },
  ];

  it('names the seeded key of a reference subject: the same words, whatever their case and spacing', () => {
    expect(seedKeyOf('Оплата счёта', SEED)).toBe('billing');
    expect(seedKeyOf(' оплата  СЧЁТА ', SEED)).toBe('billing');
    expect(seedKeyOf('Настройка агента', SEED)).toBe('agent-setup');
  });

  it('names none for a subject the list does not have: part of one, or its key', () => {
    expect(seedKeyOf('оплата', SEED)).toBeNull();
    expect(seedKeyOf('billing', SEED)).toBeNull();
    expect(seedKeyOf('Оплата счёта', [])).toBeNull();
  });

  it('names none for "no subject"', () => {
    expect(seedKeyOf(null, SEED)).toBeNull();
  });
});

describe('parseCsv', () => {
  it('reads a file with a BOM, CRLF line ends and quoted fields', () => {
    const rows = parseCsv(
      csv(
        '"1","chat-a","alpha","2026-11-20T09:00:00Z","12","Оплата счёта","resolved",""',
        '"2","chat-b","alpha","2026-11-21T09:00:00Z","7","","unknown","нет темы"',
      ),
    );
    expect(rows).toEqual([
      {
        n: '1',
        chatId: 'chat-a',
        agent: 'alpha',
        lastMessageAt: '2026-11-20T09:00:00Z',
        messages: '12',
        subject: 'Оплата счёта',
        outcome: 'resolved',
        note: '',
      },
      {
        n: '2',
        chatId: 'chat-b',
        agent: 'alpha',
        lastMessageAt: '2026-11-21T09:00:00Z',
        messages: '7',
        subject: '',
        outcome: 'unknown',
        note: 'нет темы',
      },
    ]);
  });

  it('keeps a comma, a doubled quote and a line break that are inside quotes', () => {
    const [row] = parseCsv(
      csv('1,chat-a,alpha,x,3,"refunds, ""late"" ones","open","two\r\nlines"'),
    );
    expect(row.subject).toBe('refunds, "late" ones');
    expect(row.note).toBe('two\r\nlines');
  });

  it('reads plain LF and unquoted fields the same way, and skips blank lines', () => {
    expect(parseCsv(`${HEADER}\n1,chat-a,alpha,x,3,billing,open,\n\n`)).toEqual(
      [
        {
          n: '1',
          chatId: 'chat-a',
          agent: 'alpha',
          lastMessageAt: 'x',
          messages: '3',
          subject: 'billing',
          outcome: 'open',
          note: '',
        },
      ],
    );
  });

  it('reads a last line with no line end', () => {
    expect(parseCsv(`${HEADER}\n1,c,a,x,3,billing,open,note`)[0].note).toBe(
      'note',
    );
  });

  it('gives a row that is short its missing fields empty', () => {
    expect(parseCsv(`${HEADER}\n1,chat-a`)[0]).toMatchObject({
      n: '1',
      chatId: 'chat-a',
      subject: '',
      outcome: '',
    });
  });

  it('is empty for an empty file', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv(BOM)).toEqual([]);
  });
});

describe('readLabels', () => {
  const row = (over: Record<string, string>) => ({
    n: '1',
    chatId: 'chat-a',
    agent: 'alpha',
    lastMessageAt: 'x',
    messages: '3',
    subject: 'billing',
    outcome: 'resolved',
    note: '',
    ...over,
  });

  it('reads a subject and an outcome', () => {
    expect(readLabels([row({ n: '7', outcome: ' Open ' })])).toEqual({
      labels: [{ n: 7, chatId: 'chat-a', subject: 'billing', outcome: 'open' }],
      unlabelled: [],
      invalid: [],
    });
  });

  // "No subject" is a label: small talk, or too mixed to name. It is the
  // person's answer to the question the model may answer with no topic.
  it('reads an empty subject with the note "нет темы" as "no subject"', () => {
    const { labels, unlabelled } = readLabels([
      row({ subject: '', note: ' Нет темы ' }),
    ]);
    expect(labels).toEqual([
      { n: 1, chatId: 'chat-a', subject: null, outcome: 'resolved' },
    ]);
    expect(unlabelled).toEqual([]);
  });

  it('skips a row with an empty subject or an empty outcome, and counts it as unlabelled', () => {
    const result = readLabels([
      row({ n: '1', subject: '' }),
      row({ n: '2', subject: '  ', note: 'потом' }),
      row({ n: '3', outcome: '' }),
      row({ n: '4' }),
    ]);
    expect(result.unlabelled).toEqual([1, 2, 3]);
    expect(result.labels.map((l) => l.n)).toEqual([4]);
  });

  it('sets aside an outcome that is none of the three, by its number only', () => {
    const result = readLabels([
      row({ n: '5', outcome: 'cannot tell' }),
      row({ n: '6' }),
    ]);
    expect(result.invalid).toEqual([5]);
    expect(result.labels.map((l) => l.n)).toEqual([6]);
  });

  it('refuses a file without the columns it reads, and names them', () => {
    expect(() => readLabels([{ n: '1', chatId: 'c' }])).toThrow(
      'labels.csv has no column: subject, outcome, note',
    );
  });

  it('refuses a row whose number is not one, and one number given twice', () => {
    expect(() => readLabels([row({ n: 'x' })])).toThrow(
      'labels.csv: row 1 has no conversation number',
    );
    expect(() => readLabels([row({ n: '3' }), row({ n: '3' })])).toThrow(
      'labels.csv: conversation 3 is labelled twice',
    );
  });
});

describe('sameSubject', () => {
  it('holds the same words to be the same subject, whatever their case and spacing', () => {
    expect(sameSubject('Оплата счёта', ' оплата  СЧЁТА ')).toBe(true);
    expect(sameSubject('billing', 'Billing')).toBe(true);
  });

  it('holds other words to be another subject', () => {
    expect(sameSubject('billing', 'refunds')).toBe(false);
  });

  it('never holds "no subject" to be the same as anything, another "no subject" included', () => {
    expect(sameSubject(null, null)).toBe(false);
    expect(sameSubject(null, 'billing')).toBe(false);
  });
});

describe('parseTranscript', () => {
  const file = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      n: 3,
      chatId: 'chat-c',
      agent: 'alpha',
      lastMessageAt: '2026-11-20T09:00:00Z',
      messages: [
        { role: 'user', ts: 1, text: 'hi' },
        { role: 'assistant', ts: 2, text: 'hello' },
      ],
      ...over,
    });

  it('reads the conversation number, its id and the messages', () => {
    expect(parseTranscript(file(), '003.json')).toEqual({
      n: 3,
      chatId: 'chat-c',
      messages: [
        { role: 'user', text: 'hi' },
        { role: 'assistant', text: 'hello' },
      ],
    });
  });

  // The message of a failure names the file and never quotes it: what is
  // in it is somebody's conversation.
  it.each([
    ['not JSON', '{"n": 3, "messages": [', 'is not JSON'],
    ['without a number', file({ n: 'three' }), 'has no conversation number'],
    ['without messages', file({ messages: 'none' }), 'has no messages'],
    [
      'with a message of another role',
      file({ messages: [{ role: 'system', ts: 1, text: 'SECRET PROMPT' }] }),
      'message 1 is not a user or assistant message with a text',
    ],
    [
      'with a message without a text',
      file({ messages: [{ role: 'user', ts: 1 }] }),
      'message 1 is not a user or assistant message with a text',
    ],
  ])('refuses a file %s, naming the file only', (_name, content, why) => {
    expect(() => parseTranscript(content, '003.json')).toThrow(
      `transcripts/003.json ${why}`,
    );
    try {
      parseTranscript(content, '003.json');
    } catch (err) {
      expect((err as Error).message).not.toContain('SECRET');
    }
  });
});
