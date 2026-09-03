// Ceiling for one uploaded zip. The archive streams to disk, never to memory,
// so this guards ephemeral storage on the API pod rather than RAM; 4 GiB is
// comfortably above any documentation set seen so far while still refusing
// an accidental multi-terabyte upload.
const DEFAULT_ARCHIVE_MAX_BYTES = 4 * 1024 * 1024 * 1024;

export function archiveMaxBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.KNOWLEDGE_ARCHIVE_MAX_BYTES;
  if (raw === undefined || raw.trim() === '') return DEFAULT_ARCHIVE_MAX_BYTES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_ARCHIVE_MAX_BYTES;
  }
  return Math.floor(parsed);
}
