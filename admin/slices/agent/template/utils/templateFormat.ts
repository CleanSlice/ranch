/**
 * Pure helpers behind the templates list and detail (CLEAN-130): the initials
 * tile, the human labels for Kubernetes resource quantities, and the
 * "N agents running" line. No Vue in here so the exact text is pinned by
 * `templateFormat.test.ts`.
 */

/** `Dreamvention Support Agent` → `DS`; a name without letters → `?`. */
export function templateInitials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return letters || '?';
}

/**
 * A stable hue (0–359) for a template id, so the same template gets the same
 * tile colour on every screen and every reload.
 */
export function templateHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

const CPU_RE = /^(\d+(?:\.\d+)?)(m?)$/;

/** `2000m` → 2000, `2` → 2000, `0.5` → 500. Unreadable → 0. */
export function cpuMilli(cpu: string): number {
  const m = CPU_RE.exec(cpu.trim());
  if (!m) return 0;
  const n = parseFloat(m[1]!);
  return m[2] === 'm' ? n : n * 1000;
}

const MEM_RE = /^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti|K|M|G|T)?$/;
const MIB = 1024 * 1024;
const MEM_BYTES: Record<string, number> = {
  Ki: 1024,
  Mi: MIB,
  Gi: 1024 * MIB,
  Ti: 1024 * 1024 * MIB,
  K: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
};

/** `2Gi` → 2048, `512Mi` → 512, plain bytes → MiB. Unreadable → 0. */
export function memoryMi(mem: string): number {
  const m = MEM_RE.exec(mem.trim());
  if (!m) return 0;
  const n = parseFloat(m[1]!);
  const unit = m[2];
  return (n * (unit ? MEM_BYTES[unit]! : 1)) / MIB;
}

/** `2000m` → `2 vCPU`, `250m` → `0.25 vCPU`. */
export function cpuLabel(cpu: string): string {
  const milli = cpuMilli(cpu);
  return `${milli ? trimNumber(milli / 1000) : '—'} vCPU`;
}

/** `2Gi` → `2 GiB`, `512Mi` → `512 MiB`. */
export function memoryLabel(mem: string): string {
  const mi = memoryMi(mem);
  if (!mi) return '— MiB';
  return mi >= 1024 ? `${trimNumber(mi / 1024)} GiB` : `${trimNumber(mi)} MiB`;
}

/** The whole number for the stat card: `2` for `2Gi`, `512` for `512Mi`. */
export function memoryStat(mem: string): { value: string; unit: 'GiB' | 'MiB' } {
  const mi = memoryMi(mem);
  return mi >= 1024
    ? { value: trimNumber(mi / 1024), unit: 'GiB' }
    : { value: trimNumber(mi), unit: 'MiB' };
}

/** Percent of `reference` that `value` takes, capped at 100; 0 without a reference. */
export function resourceShare(value: number, reference: number): number {
  if (reference <= 0) return 0;
  return Math.min(100, Math.round((value / reference) * 100));
}

/**
 * What the overview bars are measured against. There is no hard per-agent
 * cap in the API; this is the largest shape the create form suggests, so a
 * template's defaults read as "half a big agent" rather than as bare numbers.
 */
export const AGENT_REFERENCE_CPU_MILLI = 4000;
export const AGENT_REFERENCE_MEMORY_MI = 4096;

export function agentsLabel(running: number): string {
  if (running === 0) return 'No agents running';
  return `${running} agent${running === 1 ? '' : 's'} running`;
}

/** `ghcr.io/cleanslice/runtime:latest` → `runtime:latest`. */
export function imageTag(image: string): string {
  const i = image.lastIndexOf('/');
  return i === -1 ? image : image.slice(i + 1);
}

function trimNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(2)));
}
