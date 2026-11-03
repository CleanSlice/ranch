import {
  documentSubjects,
  documentYear,
  matchesDocumentName,
  MAX_SUBJECTS,
  selectDocumentsByName,
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

  it('ignores years, MY codes, drivetrains, part numbers and revision marks', () => {
    const found = documentSubjects(
      '2021 Mazda3 2.5 Turbo 7.8.2020 PT-L10-PF22CJ0P 2WD AWD 26MY v2 D3.md',
    );
    expect([...found.keys()]).toEqual(['mazda3']);
  });
});

// Production, 2026-11-02: asked for the 2026 CX-5 tire-pressure procedure,
// the agent searched the names for "CX-5 owner", got nothing back for
// "2026_CX5_OM.md", and told the person the only CX-5 manual was the 2023
// one. Names abbreviate and drop hyphens; the search must not care.
describe('matchesDocumentName', () => {
  it.each([
    ['2026_CX5_OM.md', '2026 CX-5'],
    ['2026_CX5_OM.md', '26MY cx5'],
    ['26MY CX-5 Price Bulletin FINAL.md', '2026 CX-5 price'],
    ['2025-cx-5-owners-manual-2.md', 'CX-5 owner'],
    ['2026CX-5-2026_How to connect to your in car hot spot.md', '2026 CX-5'],
    ['2021 CX-9 Order Guide 2020-08-21 (1) - Colors.csv', 'cx-9 colors'],
    // CLEAN-206: the abbreviation a manual's file carries, and an apostrophe.
    ['2026_CX5_OM.md', 'CX-5 owner'],
    ['2026_CX5_OM.md', "2026 CX-5 Owner's Manual"],
    // CLEAN-206: a sheet with no year in its name is still the 2026 CX-5's.
    [
      'Mazda_CX-5_Focal Point_Copy_Final for Design Layout_12.10.25.md',
      '2026 CX-5 Focal Point',
    ],
  ])('%s is found by "%s"', (name, search) => {
    expect(matchesDocumentName(name, search)).toBe(true);
  });

  it.each([
    ['2026 CX-50 Spec Deck.md', 'CX-5'],
    ['2025_CX5_OM.md', '2026 CX-5'],
    // A name that spells another year is not the year asked for.
    ['2025 CX-5 Focal Point.md', '2026 CX-5 Focal Point'],
    // Three letters must match a whole token, not a prefix.
    ['Audio_Settings_Guide.md', 'set'],
  ])('%s is not found by "%s"', (name, search) => {
    expect(matchesDocumentName(name, search)).toBe(false);
  });

  it('matches everything for an empty search', () => {
    expect(matchesDocumentName('anything.md', '  ')).toBe(true);
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
        // "CR-V_V2" carries no code: a single letter and a digit is a revision mark.
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

describe('selectDocumentsByName', () => {
  const pick = (names: string[], search: string) =>
    selectDocumentsByName(names, search, (n) => n);

  it('prefers the dated document of the year asked over an undated sheet', () => {
    const names = [
      'Mazda_CX-5_Focal Point_Copy_Final for Design Layout_12.10.25.md',
      '2026 CX-5 Focal Point.md',
    ];
    expect(pick(names, '2026 CX-5 Focal Point')).toEqual([
      '2026 CX-5 Focal Point.md',
    ]);
  });

  it('falls back to the undated sheet when no dated document of that year matches', () => {
    const names = [
      'Mazda_CX-5_Focal Point_Copy_Final for Design Layout_12.10.25.md',
    ];
    expect(pick(names, '2026 CX-5 Focal Point')).toEqual(names);
  });

  it('keeps the dated documents of a different year out, even with an undated match', () => {
    const names = ['2025 CX-5 Focal Point.md'];
    expect(pick(names, '2026 CX-5 Focal Point')).toEqual([]);
  });

  it('returns every match when the search names no year', () => {
    const names = [
      '2025 CX-5 Focal Point.md',
      '2026 CX-5 Focal Point.md',
      'CX-5 Focal Point undated.md',
    ];
    expect(pick(names, 'CX-5 Focal Point')).toEqual(names);
  });

  it('accepts an exact name even when the search words would not match it', () => {
    const names = ['Audio_Settings_Guide.md'];
    expect(pick(names, 'Audio_Settings_Guide.md')).toEqual(names);
  });

  it('documents the known cost: an undated sheet can answer a search for another year', () => {
    // No 2025 Focal Point is on hand, so the undated 2026 sheet is returned
    // for a 2025 question. The name is shown so the agent can say which it is.
    const names = [
      'Mazda_CX-5_Focal Point_Copy_Final for Design Layout_12.10.25.md',
    ];
    expect(pick(names, '2025 CX-5 Focal Point')).toEqual(names);
  });
});
