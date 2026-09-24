/**
 * Lazy, client-only loader for Monaco (CLEAN-112, research R8).
 *
 * The editor chunk is fetched the first time the Files tab mounts and never
 * on any other page: `monaco-editor` is only ever referenced through the
 * dynamic imports below. Workers are wired through Vite's `?worker` imports
 * so JSON diagnostics (the "Valid JSON" badge) and TypeScript tokenisation run
 * off the main thread.
 */
import type * as Monaco from 'monaco-editor';

export type MonacoApi = typeof Monaco;

let loading: Promise<MonacoApi> | null = null;

/** Language id for Monaco from a workspace path. */
export function languageFor(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  const dot = base.lastIndexOf('.');
  const ext = dot >= 0 ? base.slice(dot) : '';
  switch (ext) {
    case '.json':
    case '.jsonl':
      return 'json';
    case '.md':
    case '.markdown':
      return 'markdown';
    case '.ts':
    case '.tsx':
      return 'typescript';
    case '.js':
    case '.mjs':
    case '.cjs':
    case '.jsx':
      return 'javascript';
    case '.py':
      return 'python';
    case '.sh':
    case '.bash':
    case '.zsh':
      return 'shell';
    case '.ps1':
      return 'powershell';
    case '.yaml':
    case '.yml':
      return 'yaml';
    case '.html':
    case '.htm':
      return 'html';
    case '.css':
      return 'css';
    case '.sql':
      return 'sql';
    case '.xml':
      return 'xml';
    case '.ini':
    case '.toml':
    case '.env':
      return 'ini';
    default:
      return base === 'dockerfile' ? 'dockerfile' : 'plaintext';
  }
}

/** Human label for the status bar. */
export function languageLabel(path: string): string {
  const id = languageFor(path);
  const labels: Record<string, string> = {
    json: 'JSON',
    markdown: 'Markdown',
    typescript: 'TypeScript',
    javascript: 'JavaScript',
    python: 'Python',
    shell: 'Shell',
    powershell: 'PowerShell',
    yaml: 'YAML',
    html: 'HTML',
    css: 'CSS',
    sql: 'SQL',
    xml: 'XML',
    ini: 'INI',
    dockerfile: 'Dockerfile',
    plaintext: 'Plain text',
  };
  return labels[id] ?? id;
}

async function load(): Promise<MonacoApi> {
  // The package's export map serves `monaco-editor/<x>` from `esm/vs/<x>.js`,
  // so the worker entries are addressed without the `esm/vs/` prefix.
  const [monaco, editorWorker, jsonWorker, cssWorker, htmlWorker, tsWorker] =
    await Promise.all([
      import('monaco-editor'),
      import('monaco-editor/editor/editor.worker?worker'),
      import('monaco-editor/language/json/json.worker?worker'),
      import('monaco-editor/language/css/css.worker?worker'),
      import('monaco-editor/language/html/html.worker?worker'),
      import('monaco-editor/language/typescript/ts.worker?worker'),
    ]);

  const env = (globalThis as unknown as { MonacoEnvironment?: unknown });
  env.MonacoEnvironment = {
    getWorker(_: string, label: string) {
      switch (label) {
        case 'json':
          return new jsonWorker.default();
        case 'css':
        case 'scss':
        case 'less':
          return new cssWorker.default();
        case 'html':
        case 'handlebars':
        case 'razor':
          return new htmlWorker.default();
        case 'typescript':
        case 'javascript':
          return new tsWorker.default();
        default:
          return new editorWorker.default();
      }
    },
  };

  // The TS worker would otherwise try to type-check every agent script
  // against nothing and paint red squiggles — highlighting only.
  monaco.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
  });
  monaco.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
  });

  return monaco;
}

/**
 * Resolve the Monaco API once per session. Safe to call from any component;
 * only ever runs in the browser (callers sit inside `<ClientOnly>`).
 */
export function useMonaco(): Promise<MonacoApi> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Monaco is browser-only'));
  }
  if (!loading) {
    loading = load().catch((err) => {
      loading = null;
      throw err;
    });
  }
  return loading;
}

/** Follows the console theme (dark class on <html>). */
export function monacoTheme(): 'vs' | 'vs-dark' {
  if (typeof document === 'undefined') return 'vs';
  return document.documentElement.classList.contains('dark') ? 'vs-dark' : 'vs';
}
