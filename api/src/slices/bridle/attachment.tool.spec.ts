import type { Request } from 'express';
import { BridleAttachmentTool } from './attachment.tool';
import { IBridleAttachmentGateway } from './domain/attachment.gateway';
import type { IStoreAttachmentInput } from './domain/attachment.gateway';
import type { IBridleStoredAttachment } from './domain/bridle.types';
import {
  EXPECTED,
  buildCornerSheet,
  buildLongSheet,
  buildSupplierInvoice,
} from './domain/__fixtures__/buildReferenceWorkbooks';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const INVOICE_ID = '0b53c9a4-7f4e-4bb1-a6b1-6a1f2f9c8f21';
const LONG_ID = '5d1c2a3e-1111-4222-8333-444455556666';
const CORNER_ID = '9c9c9c9c-3333-4444-8555-666677778888';
const NOTE_ID = '7a7a7a7a-2222-4333-8444-555566667777';

class MemoryGateway extends IBridleAttachmentGateway {
  private readonly items = new Map<string, IBridleStoredAttachment>();

  seed(agentId: string, item: IBridleStoredAttachment): void {
    this.items.set(`${agentId}/${item.id}`, item);
  }

  async store(input: IStoreAttachmentInput): Promise<{ id: string }> {
    void input;
    throw new Error('not used');
  }

  async fetch(
    agentId: string,
    id: string,
  ): Promise<IBridleStoredAttachment | null> {
    return this.items.get(`${agentId}/${id}`) ?? null;
  }
}

type ToolRequest = Parameters<BridleAttachmentTool['query']>[2];

function asAgent(agentId: string): ToolRequest {
  return { user: { sub: `agent:${agentId}` } } as unknown as ToolRequest;
}

function parse<T = Record<string, unknown>>(result: {
  content: { text: string }[];
  isError?: boolean;
}): T {
  return JSON.parse(result.content[0].text) as T;
}

describe('query_attachment', () => {
  let tool: BridleAttachmentTool;
  const agentA = asAgent('agent-a');

  beforeAll(async () => {
    const gw = new MemoryGateway();
    const invoice = await buildSupplierInvoice();
    gw.seed('agent-a', {
      id: INVOICE_ID,
      name: 'supplier-invoice.xlsx',
      mimeType: XLSX_MIME,
      size: invoice.length,
      body: invoice,
    });
    const long = await buildLongSheet(300);
    gw.seed('agent-a', {
      id: LONG_ID,
      name: 'long.xlsx',
      mimeType: XLSX_MIME,
      size: long.length,
      body: long,
    });
    const corner = await buildCornerSheet(260, 200);
    gw.seed('agent-a', {
      id: CORNER_ID,
      name: 'corner.xlsx',
      mimeType: XLSX_MIME,
      size: corner.length,
      body: corner,
    });
    gw.seed('agent-a', {
      id: NOTE_ID,
      name: 'note.txt',
      mimeType: 'text/plain',
      size: 5,
      body: Buffer.from('hello'),
    });
    tool = new BridleAttachmentTool(gw);
  });

  describe('authorisation', () => {
    it('refuses a caller that is not an agent runtime', async () => {
      const out = await tool.query(
        { attachment_id: INVOICE_ID, op: 'describe' },
        undefined,
        { user: { sub: 'user-1' } } as unknown as Request,
      );
      expect(out.isError).toBe(true);
      expect(out.content[0].text).toContain(
        'only be called by an agent runtime',
      );
    });

    it("does not reveal another agent's attachment", async () => {
      const out = await tool.query(
        { attachment_id: INVOICE_ID, op: 'describe' },
        undefined,
        asAgent('agent-b'),
      );
      expect(out.isError).toBe(true);
      expect(out.content[0].text).toBe(
        `Attachment ${INVOICE_ID} is not available to this agent.`,
      );
    });

    it('rejects a non-spreadsheet attachment by name and type', async () => {
      const out = await tool.query(
        { attachment_id: NOTE_ID, op: 'describe' },
        undefined,
        agentA,
      );
      expect(out.isError).toBe(true);
      expect(out.content[0].text).toContain('"note.txt" is a text/plain');
    });
  });

  describe('describe', () => {
    it('lists sheets with state, size and a header guess', async () => {
      const out = parse<{
        attachment: { id: string; name: string };
        sheets: Array<Record<string, unknown>>;
      }>(
        await tool.query(
          { attachment_id: INVOICE_ID, op: 'describe' },
          undefined,
          agentA,
        ),
      );

      expect(out.attachment).toEqual({
        id: INVOICE_ID,
        name: 'supplier-invoice.xlsx',
      });
      expect(out.sheets).toHaveLength(3);
      expect(out.sheets[0]).toMatchObject({
        index: 1,
        name: EXPECTED.sheetNames[0],
        state: 'visible',
        mergedRegions: EXPECTED.sheet1.mergedRegions,
        headerGuess: {
          row: EXPECTED.sheet1.headerRow,
          cells: { B: 'Товар', C: 'Кількість', D: 'Ціна', F: 'Сума' },
        },
      });
      expect(out.sheets[2]).toMatchObject({
        state: 'hidden',
        name: EXPECTED.hiddenSheet,
      });
      expect(out.sheets[2]).not.toHaveProperty('headerGuess');
    });
  });

  describe('read', () => {
    it('returns the rows of a range, merged regions once', async () => {
      const out = parse<{
        rows: Array<{ row: number; cells: Array<{ address: string }> }>;
      }>(
        await tool.query(
          { attachment_id: INVOICE_ID, op: 'read', sheet: 1, range: 'A1:F12' },
          undefined,
          agentA,
        ),
      );
      expect(out.rows.map((r) => r.row)).toEqual([
        1, 2, 3, 4, 5, 6, 10, 11, 12,
      ]);
      expect(out.rows[0].cells).toHaveLength(1);
      expect(out.rows[0].cells[0]).toMatchObject({
        address: 'A1',
        span: EXPECTED.sheet1.supplierSpan,
      });
    });

    it('needs a sheet', async () => {
      const out = await tool.query(
        { attachment_id: INVOICE_ID, op: 'read' },
        undefined,
        agentA,
      );
      expect(out.isError).toBe(true);
      expect(out.content[0].text).toContain('needs a sheet');
    });

    it('names the available sheets when the requested one is missing', async () => {
      const out = await tool.query(
        { attachment_id: INVOICE_ID, op: 'read', sheet: 'Итого' },
        undefined,
        agentA,
      );
      expect(out.isError).toBe(true);
      expect(out.content[0].text).toContain(
        'Sheet "Итого" not found; available: 1 "',
      );
    });

    it('gates hidden sheets behind include_hidden', async () => {
      const refused = await tool.query(
        { attachment_id: INVOICE_ID, op: 'read', sheet: EXPECTED.hiddenSheet },
        undefined,
        agentA,
      );
      expect(refused.isError).toBe(true);
      expect(refused.content[0].text).toContain('include_hidden');

      const out = parse<{ rows: unknown[] }>(
        await tool.query(
          {
            attachment_id: INVOICE_ID,
            op: 'read',
            sheet: EXPECTED.hiddenSheet,
            include_hidden: true,
          },
          undefined,
          agentA,
        ),
      );
      expect(out.rows).toHaveLength(EXPECTED.sheet3.rows);
    });

    it('rejects a malformed range and one over the cell cap', async () => {
      const bad = await tool.query(
        { attachment_id: INVOICE_ID, op: 'read', sheet: 1, range: 'x' },
        undefined,
        agentA,
      );
      expect(bad.isError).toBe(true);
      expect(bad.content[0].text).toContain('A1 notation');

      // 260 × 200 = 52 000 cells in the used area: over the cap even after
      // clipping. (A range past the used area is clipped first, on purpose.)
      const big = await tool.query(
        { attachment_id: CORNER_ID, op: 'read', sheet: 1 },
        undefined,
        agentA,
      );
      expect(big.isError).toBe(true);
      expect(big.content[0].text).toBe(
        'Range covers 52,000 cells; narrow it below 50,000.',
      );

      const clipped = await tool.query(
        { attachment_id: LONG_ID, op: 'read', sheet: 1, range: 'A1:ZZZ9999' },
        undefined,
        agentA,
      );
      expect(clipped.isError).toBeUndefined();
      expect(parse<{ warnings: string[] }>(clipped).warnings[0]).toMatch(
        /clipped/,
      );
    });
  });

  describe('aggregate', () => {
    const run = (extra: Record<string, unknown>) =>
      tool.query(
        {
          attachment_id: INVOICE_ID,
          op: 'aggregate',
          sheet: 1,
          ...extra,
        } as never,
        undefined,
        agentA,
      );

    it('sums the item rows and lists the cells it counted', async () => {
      const out = parse<{
        value: number;
        range: string;
        covered: { cellsCounted: number };
        cells: Array<{ address: string; computed: boolean }>;
      }>(await run({ fn: 'sum', range: 'F5:F6' }));

      expect(out.value).toBe(EXPECTED.sheet1.itemSum);
      expect(out.range).toBe('F5:F6');
      expect(out.covered.cellsCounted).toBe(2);
      expect(out.cells.map((c) => c.address)).toEqual(['F5', 'F6']);
      expect(out.cells.every((c) => c.computed)).toBe(true);
    });

    it('excludes formula totals when include_computed is false', async () => {
      const out = parse<{
        value: number;
        covered: {
          cellsCounted: number;
          cellsSkipped: { computedExcluded: number };
        };
      }>(await run({ fn: 'sum', range: 'F5:F12', include_computed: false }));

      // Only F10 (entered subtotal) is a plain number in F5:F12.
      expect(out.value).toBe(EXPECTED.sheet1.subtotal);
      expect(out.covered.cellsCounted).toBe(1);
      expect(out.covered.cellsSkipped.computedExcluded).toBe(4);
    });

    it('finds the largest item on sheet 2 with its address', async () => {
      const out = parse<{
        value: number;
        cells: Array<{ address: string; value: number }>;
      }>(
        await tool.query(
          {
            attachment_id: INVOICE_ID,
            op: 'aggregate',
            sheet: 2,
            fn: 'max',
            range: 'F:F',
          },
          undefined,
          agentA,
        ),
      );
      expect(out.value).toBe(EXPECTED.sheet2.max);
      expect(
        out.cells.find((c) => c.value === EXPECTED.sheet2.max)?.address,
      ).toBe(EXPECTED.sheet2.maxAddress);
    });

    it('applies a where filter on another column', async () => {
      const out = parse<{ value: number; covered: { cellsCounted: number } }>(
        await run({
          fn: 'sum',
          range: 'F5:F6',
          where: { column: 'B', op: 'contains', value: 'Avalanche' },
        }),
      );
      expect(out.covered.cellsCounted).toBe(1);
      expect(out.value).toBe(80 * 52);
    });

    it('counts a merged region once and reports the duplicates it skipped', async () => {
      const out = parse<{
        value: number | null;
        covered: {
          cellsCounted: number;
          cellsSkipped: { nonNumeric: number; mergedDuplicates: number };
        };
      }>(await run({ fn: 'count', range: 'A1:AN1' }));

      expect(out.value).toBeNull();
      expect(out.covered.cellsCounted).toBe(0);
      expect(out.covered.cellsSkipped.nonNumeric).toBe(1);
      expect(out.covered.cellsSkipped.mergedDuplicates).toBe(39);
    });

    it('returns null when nothing numeric is in range', async () => {
      const out = parse<{ value: number | null }>(
        await run({ fn: 'sum', range: 'B4:B6' }),
      );
      expect(out.value).toBeNull();
    });

    it('requires range and fn', async () => {
      expect((await run({ fn: 'sum' })).content[0].text).toContain(
        'needs a range',
      );
      expect((await run({ range: 'F5:F6' })).content[0].text).toContain(
        'needs fn',
      );
    });
  });

  describe('find', () => {
    it('returns matching cells with the rest of their row', async () => {
      const out = parse<{
        matches: Array<{
          address: string;
          rowCells: Array<{
            address: string;
            value: unknown;
            computed: boolean;
          }>;
        }>;
      }>(
        await tool.query(
          { attachment_id: INVOICE_ID, op: 'find', sheet: 1, query: 'всього' },
          undefined,
          agentA,
        ),
      );
      expect(out.matches).toHaveLength(1);
      expect(out.matches[0].address).toBe('B12');
      expect(out.matches[0].rowCells).toEqual([
        { address: 'F12', value: EXPECTED.sheet1.grandTotal, computed: true },
      ]);
    });

    it('needs a query', async () => {
      const out = await tool.query(
        { attachment_id: INVOICE_ID, op: 'find', sheet: 1 },
        undefined,
        agentA,
      );
      expect(out.isError).toBe(true);
    });
  });
});
