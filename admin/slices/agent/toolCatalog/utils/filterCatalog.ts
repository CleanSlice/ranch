import type { IAgentToolCatalog, IAgentToolGroup } from '../domain/toolCatalog.types';

const norm = (s: string): string => s.trim().toLowerCase();

/**
 * The panel's search (CLEAN-109): groups whose tools match the query on
 * title, technical name or description, with only the matching tools kept.
 * An external group matches on its own title and description. An empty
 * query returns the groups untouched.
 */
export function filterCatalog(
  catalog: IAgentToolCatalog | undefined,
  query: string,
): IAgentToolGroup[] {
  if (!catalog) return [];
  const q = norm(query);
  if (!q) return catalog.groups;

  const words = q.split(/\s+/).filter(Boolean);
  const matches = (...fields: Array<string | undefined>): boolean => {
    const hay = fields.map((f) => norm(f ?? '')).join(' ');
    return words.every((w) => hay.includes(w));
  };

  const out: IAgentToolGroup[] = [];
  for (const group of catalog.groups) {
    if (group.kind === 'external') {
      if (matches(group.title, group.description)) out.push(group);
      continue;
    }
    const tools = group.tools.filter((t) =>
      matches(t.title, t.name, t.description),
    );
    if (tools.length) out.push({ ...group, tools });
  }
  return out;
}
