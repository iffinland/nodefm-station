/* ============================================================
 * Shared test bridge double for the account write gate.
 *
 * Every signed write now goes through `requireAccountWrite`, which
 * reads `GET_SELECTED_ACCOUNT` first. Tests that verify publish,
 * chat, or tip request shapes are not about account state, so they
 * answer that one read with an already-unlocked account and keep
 * their own action handling for everything else.
 * ============================================================ */

export const TEST_WRITE_ACCOUNT = {
  address: 'QWifxJWGbJZ6Yo6kiimFkBGcm4AxQefdUm',
  isUnlocked: true,
  name: 'iffi_vaba_mees',
} as const;

export type TestBridgeHandler = (request: Record<string, unknown>) => Promise<unknown>;

/** Answer the write gate's account read, then delegate to the test handler. */
export function withUnlockedTestAccount(handler: TestBridgeHandler): TestBridgeHandler {
  return async (request: Record<string, unknown>) =>
    request.action === 'GET_SELECTED_ACCOUNT' ? { ...TEST_WRITE_ACCOUNT } : handler(request);
}
