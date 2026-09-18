/**
 * Twin of admin/slices/bridle/utils/bun-test.d.ts.
 *
 * The `*.test.ts` files beside this one run under `bun test`, which ships
 * `bun:test` itself. `nuxt typecheck` walks the same folder with no Bun types
 * installed, and adding `@types/bun` for a handful of matchers is a dependency
 * this slice does not need — so this declares just the surface the tests use.
 * Delete it if `@types/bun` ever lands in app/package.json.
 */
declare module 'bun:test' {
  interface IMatchers {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toMatchObject(expected: Record<string, unknown>): void;
    toHaveProperty(name: string): void;
    not: IMatchers;
  }

  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function expect(actual: unknown): IMatchers;
}
