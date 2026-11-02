import { scanDocumentLines } from './documentScan';

// CLEAN-203: the 26MY CX-30 equipment sheet, as the base stores it. The
// row the person needs carries "liftgate"; similarity search missed it for
// the two-word query, a substring scan cannot.
const SHEET = [
  'Category,Feature,2.5 S,2.5 S Select Sport,2.5 S Preferred,2.5 S Aire Edition,2.5 S Carbon Edition,2.5 S Premium,2.5 Turbo Aire Edition*,2.5 Turbo Premium Plus*',
  'Engine & Mechanical,SKYACTIV-G(R) 2.5 DOHC 16-valve 4-cylinder engine,Std,Std,Std,Std,Std,Std,-,-',
  '',
  'Exterior Features,Power rear liftgate,-,-,-,-,-,Std,Std,Std',
  'Exterior Features,Privacy glass - rear side windows and rear liftgate glass,-,Std,Std,Std,Std,Std,Std,Std',
  'Interior Features,Power windows with one-touch down,Std,Std,Std,Std,Std,Std,Std,Std',
].join('\n');

describe('scanDocumentLines', () => {
  it('returns the CSV header and the rows carrying the query words, most words first', () => {
    const lines = scanDocumentLines(SHEET, 'power liftgate');

    expect(lines.map((l) => [l.line, l.hits])).toEqual([
      [1, 0],
      [4, 2],
      [5, 1],
      [6, 1],
    ]);
    expect(lines[1].text).toBe(
      'Exterior Features,Power rear liftgate,-,-,-,-,-,Std,Std,Std',
    );
  });

  it('ignores case and stopwords, and matches nothing for a query of stopwords only', () => {
    expect(scanDocumentLines(SHEET, 'LIFTGATE').map((l) => l.line)).toEqual([
      1, 4, 5,
    ]);
    expect(scanDocumentLines(SHEET, 'the and')).toEqual([]);
  });

  it('keeps no header for prose and cuts to the budget', () => {
    const prose = [
      'Tire Pressure Monitoring System',
      'When the warning light turns on, adjust the tire pressure.',
      'Unrelated paragraph.',
    ].join('\n');

    // Both lines carry both words: the document's own order decides.
    expect(
      scanDocumentLines(prose, 'tire pressure').map((l) => l.line),
    ).toEqual([1, 2]);
    expect(
      scanDocumentLines(prose, 'tire pressure', 40).map((l) => l.line),
    ).toEqual([1]);
  });

  it('cuts a line longer than a row', () => {
    const long = `liftgate ${'x'.repeat(5_000)}`;
    const [line] = scanDocumentLines(long, 'liftgate');
    expect(line.text.length).toBe(1_200);
    expect(line.text.endsWith('…')).toBe(true);
  });
});
