import type { IFileContent, IFileNode } from '../domain/templateFile.types';

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

/** Maps the template-files API onto domain shapes; reads defensively. */
export class TemplateFileMapper {
  toNodeList(raw: unknown): IFileNode[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => this.toNode(item))
      .filter((n): n is IFileNode => n !== null);
  }

  toContent(raw: unknown): IFileContent | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.path !== 'string') return null;
    return {
      path: o.path,
      content: str(o.content),
      size: num(o.size),
      updatedAt: str(o.updatedAt),
    };
  }

  private toNode(raw: unknown): IFileNode | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.path !== 'string') return null;
    return { path: o.path, size: num(o.size), updatedAt: str(o.updatedAt) };
  }
}
