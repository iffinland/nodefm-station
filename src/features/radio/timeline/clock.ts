/* ============================================================
 * NodeFM Station — Radio Timeline Clock
 *
 * Isolated wall-clock access. The timeline engine itself is
 * pure and receives `nowUtcMs` as an explicit argument; this
 * module is the only place in the radio feature that is allowed
 * to read the real wall clock.
 * ============================================================ */

type NowUtcProvider = () => number;

let nowUtcProvider: NowUtcProvider | null = null;

/** Return the current UTC wall-clock time in milliseconds. */
export function getNowUtcMs(): number {
  return nowUtcProvider ? nowUtcProvider() : Date.now();
}

/**
 * Replace the wall-clock source. This is intended for deterministic
 * tests and future server-time correction; normal app code should
 * leave the default provider in place.
 */
export function setNowUtcMsProviderForTests(provider: NowUtcProvider | null): void {
  nowUtcProvider = provider;
}
