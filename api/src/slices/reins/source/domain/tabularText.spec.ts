// CLEAN-195: a CSV goes into the retrieval service one line per row, each
// line carrying the document's name and the column labels, so a question
// that names the model and the year lands on the row that answers it.

import { isTabularSource, parseCsv, tabularRowsText } from './tabularText';

const DECK =
  '26my-mazda3-spec-deck-final-effective-06122026 - Specifications.csv';
const CSV = [
  'Category,Specification,Sub-Item,Sedan,Hatchback',
  'Exterior Dimensions,"Minimum Ground Clearance, unladen (inches)",,5.5,5.5',
  'Weights and Capacities,Fuel Tank Capacity (gallons),,FWD 13.2 / AWD 12.7,FWD 13.2 / AWD 12.7',
  ',,,,',
].join('\r\n');

describe('isTabularSource', () => {
  test('a CSV file by mime type or by name', () => {
    expect(
      isTabularSource({ type: 'file', mimeType: 'text/csv', name: 'x' }),
    ).toBe(true);
    expect(
      isTabularSource({
        type: 'file',
        mimeType: null,
        name: 'Deck - Specifications.CSV',
      }),
    ).toBe(true);
    expect(
      isTabularSource({
        type: 'file',
        mimeType: 'application/pdf',
        name: 'deck.pdf',
      }),
    ).toBe(false);
    expect(
      isTabularSource({ type: 'text', mimeType: 'text/csv', name: 'x.csv' }),
    ).toBe(false);
  });
});

describe('parseCsv', () => {
  test('quoted cells keep the delimiter, a doubled quote and a line break', () => {
    expect(parseCsv('a,b\n"x, y","say ""hi""\nthere",z')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"\nthere', 'z'],
    ]);
  });

  test('picks the delimiter the first line uses most', () => {
    expect(parseCsv('a;b;c\n1;2;3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });
});

describe('tabularRowsText', () => {
  test('every row carries the document name and the column labels; empty cells and empty rows are skipped', () => {
    expect(tabularRowsText(DECK, CSV)).toBe(
      [
        '26my-mazda3-spec-deck-final-effective-06122026 - Specifications | Category: Exterior Dimensions | Specification: Minimum Ground Clearance, unladen (inches) | Sedan: 5.5 | Hatchback: 5.5',
        '26my-mazda3-spec-deck-final-effective-06122026 - Specifications | Category: Weights and Capacities | Specification: Fuel Tank Capacity (gallons) | Sedan: FWD 13.2 / AWD 12.7 | Hatchback: FWD 13.2 / AWD 12.7',
      ].join('\n'),
    );
  });

  test('a column without a label contributes the value alone', () => {
    expect(tabularRowsText('t.csv', 'Trim,,MSRP\n2.5 S,FWD,"$26,375"')).toBe(
      't | Trim: 2.5 S | FWD | MSRP: $26,375',
    );
  });

  test('a header-only file or a single column is not a table', () => {
    expect(tabularRowsText('t.csv', 'a,b,c')).toBeNull();
    expect(tabularRowsText('t.csv', 'notes\nline one\nline two')).toBeNull();
  });
});
