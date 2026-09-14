import { SPREADSHEET_HINT } from './attachment.constants';

/**
 * The hint is the only place the model is told how to get past the preview,
 * and it is read at the moment the file arrives — the moment it decides how
 * to answer a numeric question. If it names a tool that is not in the model's
 * list, the instruction is unfollowable and the model improvises from the
 * preview instead (CLEAN-85).
 */
describe('SPREADSHEET_HINT', () => {
  it('names the tool', () => {
    expect(SPREADSHEET_HINT).toContain('query_attachment');
  });

  it('warns that the runtime may prefix it with the MCP server name', () => {
    // runtime/src/slices/setup/mcp/data/mcp.gateway.ts registers every MCP
    // tool as `${serverName}__${tool.name}`, so the bare name alone is not
    // callable. The api cannot know which server a given agent got it from —
    // Documents is injected for all, but a template may attach Ranch or
    // Knowledge, which serve the same registry — so the hint has to cover
    // both shapes rather than hardcode one.
    expect(SPREADSHEET_HINT).toContain('Documents__query_attachment');
  });

  it('still says the inlined content is only a preview', () => {
    expect(SPREADSHEET_HINT).toContain('preview');
  });

  it('stays short enough to ride along on every attachment', () => {
    expect(SPREADSHEET_HINT.length).toBeLessThan(500);
  });
});
