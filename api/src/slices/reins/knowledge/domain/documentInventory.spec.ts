import {
  documentSubjects,
  documentYear,
  MAX_SUBJECTS,
  summarizeDocumentNames,
} from './documentInventory';

// Names as the reference base spells them (CLEAN-198): the model year
// leads, revision and effective dates trail, MY codes come in every case.
describe('documentYear', () => {
  it.each([
    ['2021 CX-9 Order Guide 2020-08-21 (1) - Colors.csv', '2021'],
    ['CX-5 21MY Pricing Bulletin effective date 08252020.md', '2021'],
    ['3. 21MY Mazda3 Product Information Bulletin Final 6-2020.md', '2021'],
    ['2023my-safety-feature-chart.md', '2023'],
    ['26MY Mazda3 Spec Deck - Specifications.csv', '2026'],
    ['MY26 CX-50 Focal Point.md', '2026'],
    ['2026CX-5-2026_How to connect to your in car hot spot.md', '2026'],
    ['2027_CX5_OM.md', '2027'],
  ])('%s → %s', (name, year) => {
    expect(documentYear(name)).toBe(year);
  });

  it('spells no year for a name without one, and never reads a date as one', () => {
    expect(documentYear('Advanced_Keyless_Entry_System_Guide.md')).toBeNull();
    expect(documentYear('Pricing effective 08252020.md')).toBeNull();
    expect(documentYear('CX-5 Influencer Script - CR-V_V2.md')).toBeNull();
  });
});

describe('documentSubjects', () => {
  it('finds product codes however they are hyphenated or cased', () => {
    expect([
      ...documentSubjects('2026 CX-5 vs cx5 and Mazda3 MX-5 RF.md').entries(),
    ]).toEqual([
      ['cx5', 'CX-5'],
      ['mazda3', 'Mazda3'],
      ['mx5', 'MX-5'],
    ]);
  });

  it('ignores years, MY codes, drivetrains and part numbers', () => {
    const found = documentSubjects(
      '2021 Mazda3 2.5 Turbo 7.8.2020 PT-L10-PF22CJ0P 2WD AWD 26MY.md',
    );
    expect([...found.keys()]).toEqual(['mazda3', 'l10']);
  });
});

describe('summarizeDocumentNames', () => {
  const names = [
    '2026 CX-5 full U.S. PR MESSAGING QA.md',
    '26MY CX-5 Spec Deck - Specifications.csv',
    '2025 CX-5 Order Form.md',
    'CX-5 Influencer Script - CR-V_V2.md',
    '2021 Mazda6 Order Guide 2020-11-16 (1).md',
    'Audio_Settings_Guide.md',
  ];

  it('counts years ascending and subjects by frequency, most common spelling first', () => {
    expect(summarizeDocumentNames(names)).toEqual({
      documents: 6,
      years: { '2021': 1, '2025': 1, '2026': 2 },
      subjects: [
        {
          subject: 'CX-5',
          documents: 4,
          years: { '2025': 1, '2026': 2, undated: 1 },
        },
        // Equal counts keep first-seen order: V2 appears in the list before Mazda6.
        { subject: 'V2', documents: 1, years: { undated: 1 } },
        { subject: 'Mazda6', documents: 1, years: { '2021': 1 } },
      ],
      undated: 2,
    });
  });

  it('prefers the spelling the names use most', () => {
    const { subjects } = summarizeDocumentNames([
      'cx5 notes.md',
      'CX-5 deck.md',
      'CX-5 form.md',
    ]);
    expect(subjects[0].subject).toBe('CX-5');
  });

  it('caps the subject list so a tail of one-off codes cannot bury the lines', () => {
    const many = Array.from(
      { length: MAX_SUBJECTS + 10 },
      (_, i) => `ab${i}.md`,
    );
    expect(summarizeDocumentNames(many).subjects).toHaveLength(MAX_SUBJECTS);
  });

  it('is empty for an empty base', () => {
    expect(summarizeDocumentNames([])).toEqual({
      documents: 0,
      years: {},
      subjects: [],
      undated: 0,
    });
  });
});
