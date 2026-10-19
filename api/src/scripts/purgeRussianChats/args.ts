export interface PurgeArgs {
  /** Scope to one agent, or null to scan every chat on the installation. */
  agent: string | null;
  /** Where the archive of deleted chats is written, inside the pod. */
  archive: string | null;
  dryRun: boolean;
  limit: number | null;
  concurrency: number;
}

const takeValue = (argv: string[], flag: string, i: number): string => {
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
};

const takeNumber = (argv: string[], flag: string, i: number): number => {
  const n = Number(takeValue(argv, flag, i));
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return n;
};

/**
 * Parses the CLI flags.
 *
 * The dry run is the default here, the inverse of the other scripts: those
 * write rows that can be written again, this one destroys chats. Deleting
 * takes a deliberate `--delete`, and `--delete` without `--archive` is
 * refused — the archive is the only thing that makes this reversible.
 */
export function parsePurgeArgs(argv: string[]): PurgeArgs {
  let agent: string | null = null;
  let archive: string | null = null;
  let dryRun = true;
  let limit: number | null = null;
  let concurrency = 8;

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--agent':
        agent = takeValue(argv, '--agent', i++);
        break;
      case '--archive':
        archive = takeValue(argv, '--archive', i++);
        break;
      case '--delete':
        dryRun = false;
        break;
      case '--limit':
        limit = takeNumber(argv, '--limit', i++);
        break;
      case '--concurrency':
        concurrency = takeNumber(argv, '--concurrency', i++);
        break;
      default:
        throw new Error(`unknown flag ${argv[i]}`);
    }
  }

  if (!dryRun && !archive) {
    throw new Error('--archive <path> is required with --delete');
  }

  return { agent, archive, dryRun, limit, concurrency };
}
