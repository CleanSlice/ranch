/**
 * Pure tree helpers for the Files explorer (CLEAN-112, US5). No Vue here so
 * `bun test` runs them: build a tree from flat paths, filter it, and answer
 * "which files does this folder cover" for the checkboxes.
 */

export interface ITreeFile {
  path: string;
  size: number;
  updatedAt: string;
  kind?: 'text' | 'binary';
  editable?: boolean;
}

export interface IFolderNode {
  type: 'folder';
  name: string;
  path: string;
  children: TreeNode[];
  /** Files under this folder, recursively. */
  count: number;
  /** Bytes under this folder, recursively. */
  bytes: number;
  /** Newest `updatedAt` under this folder. */
  updatedAt: string;
}

export interface IFileLeaf {
  type: 'file';
  name: string;
  path: string;
  size: number;
  updatedAt: string;
  kind: 'text' | 'binary';
  editable: boolean;
}

export type TreeNode = IFolderNode | IFileLeaf;

export function buildTree(files: readonly ITreeFile[]): TreeNode[] {
  const root: IFolderNode = {
    type: 'folder',
    name: '',
    path: '',
    children: [],
    count: 0,
    bytes: 0,
    updatedAt: '',
  };
  for (const file of files) {
    const segments = file.path.split('/');
    let cursor = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const name = segments[i]!;
      const path = segments.slice(0, i + 1).join('/');
      let child = cursor.children.find(
        (c): c is IFolderNode => c.type === 'folder' && c.name === name,
      );
      if (!child) {
        child = { type: 'folder', name, path, children: [], count: 0, bytes: 0, updatedAt: '' };
        cursor.children.push(child);
      }
      cursor = child;
    }
    cursor.children.push({
      type: 'file',
      name: segments[segments.length - 1]!,
      path: file.path,
      size: file.size,
      updatedAt: file.updatedAt,
      kind: file.kind ?? 'text',
      editable: file.editable ?? false,
    });
  }
  total(root);
  sortTree(root);
  return root.children;
}

function total(node: IFolderNode): void {
  let count = 0;
  let bytes = 0;
  let newest = '';
  for (const c of node.children) {
    if (c.type === 'folder') {
      total(c);
      count += c.count;
      bytes += c.bytes;
      if (c.updatedAt > newest) newest = c.updatedAt;
    } else {
      count += 1;
      bytes += c.size;
      if (c.updatedAt > newest) newest = c.updatedAt;
    }
  }
  node.count = count;
  node.bytes = bytes;
  node.updatedAt = newest;
}

function sortTree(node: IFolderNode): void {
  node.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const c of node.children) if (c.type === 'folder') sortTree(c);
}

/**
 * Keep the files whose path contains `query` (case-insensitive) and every
 * folder on the way to them; totals are recomputed for what remains. An
 * empty query returns the tree untouched.
 */
export function filterTree(tree: readonly TreeNode[], query: string): TreeNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...tree];
  const walk = (nodes: readonly TreeNode[]): TreeNode[] => {
    const out: TreeNode[] = [];
    for (const n of nodes) {
      if (n.type === 'file') {
        if (n.path.toLowerCase().includes(q)) out.push(n);
      } else {
        const children = walk(n.children);
        if (children.length) {
          const folder: IFolderNode = { ...n, children, count: 0, bytes: 0, updatedAt: '' };
          total(folder);
          out.push(folder);
        }
      }
    }
    return out;
  };
  return walk(tree);
}

/** Every file path under a folder path (or the path itself for a file). */
export function pathsUnder(files: readonly ITreeFile[], path: string): string[] {
  const prefix = path.endsWith('/') ? path : `${path}/`;
  return files.filter((f) => f.path === path || f.path.startsWith(prefix)).map((f) => f.path);
}

/** Folder paths whose every file is in `selected`. */
export function fullySelectedFolders(tree: readonly TreeNode[], selected: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  const walk = (n: TreeNode): boolean => {
    if (n.type === 'file') return selected.has(n.path);
    let all = n.children.length > 0;
    for (const c of n.children) {
      const childAll = walk(c);
      all = all && childAll;
    }
    if (all) out.add(n.path);
    return all;
  };
  for (const n of tree) walk(n);
  return out;
}

/** Folder paths that contain at least one selected file but not all. */
export function partiallySelectedFolders(tree: readonly TreeNode[], selected: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  const walk = (n: TreeNode): { some: boolean; all: boolean } => {
    if (n.type === 'file') {
      const s = selected.has(n.path);
      return { some: s, all: s };
    }
    let some = false;
    let all = n.children.length > 0;
    for (const c of n.children) {
      const r = walk(c);
      some = some || r.some;
      all = all && r.all;
    }
    if (some && !all) out.add(n.path);
    return { some, all };
  };
  for (const n of tree) walk(n);
  return out;
}

/** Folders that need to be open so every path in `paths` is visible. */
export function ancestorsOf(paths: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const p of paths) {
    const segments = p.split('/');
    for (let i = 1; i < segments.length; i++) out.add(segments.slice(0, i).join('/'));
  }
  return out;
}

/** A relative path a new file may take: no leading slash, no `.`/`..` segments. */
export function validateNewPath(path: string): string | null {
  const p = path.trim();
  if (!p) return 'Enter a path';
  if (p.startsWith('/') || p.startsWith('\\') || /^[a-zA-Z]:/.test(p)) return 'The path must be relative to the workspace';
  if (p.endsWith('/')) return 'The path must name a file';
  if (p.split('/').some((s) => s === '' || s === '.' || s === '..')) return 'The path must not contain empty, "." or ".." segments';
  if (/[\0]/.test(p)) return 'The path contains an invalid character';
  return null;
}
