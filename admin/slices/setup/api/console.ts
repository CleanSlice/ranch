/**
 * Which console this is, as the API is told on every request (CLEAN-236).
 *
 * Both consoles call one API host, and the session cookie lives on that
 * host. A sign-in belongs to the console it was made in: the API keeps a
 * cookie per console and reads this header to know which one is asking.
 * Without it there is no sign-in at all, so it goes on every request, not
 * only on the ones that happen to need it today.
 *
 * The twin of this file in the other console differs in `RANCH_CONSOLE`
 * and in nothing else.
 */
export const RANCH_CONSOLE_HEADER = 'X-Ranch-Console' as const;
export const RANCH_CONSOLE = 'admin' as const;

/** The same, as the generated SDK takes it on the calls that require it. */
export const RANCH_CONSOLE_HEADERS = {
  [RANCH_CONSOLE_HEADER]: RANCH_CONSOLE,
} as const;
