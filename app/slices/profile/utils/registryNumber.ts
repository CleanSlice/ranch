// The "registry number" printed on the pass (CLEAN-217). Pure on purpose: no
// Vue, no Nuxt aliases, so `bun test` runs it.

/**
 * The first eight letters and digits of the account id, upper case, in two
 * groups of four: `7f3a9c1e-52b4-…` → `7F3A·9C1E`.
 *
 * It is a short, recognisable handle for the full id shown on the back of the
 * pass, not a second identifier: nothing is stored or looked up by it. An id
 * with fewer than eight usable characters prints what there is; one with none
 * prints nothing and the pass leaves the block out.
 */
export function registryNumber(id: string | null | undefined): string {
  const chars = (id ?? '')
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 8)
    .toUpperCase();
  if (chars.length <= 4) return chars;
  return `${chars.slice(0, 4)}·${chars.slice(4)}`;
}
