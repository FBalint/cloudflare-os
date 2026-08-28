/**
 * An HTTP error carrying its response status, so verifiers can classify failures numerically
 * instead of parsing message text.
 */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * True only when the error carries a numeric `status` of 401/403/404 (observer lacks access).
 * Classification is numeric and never parses message text. Anything without a numeric 401/403/404
 * status MUST be rethrown by the caller, never treated as "no access".
 */
export function isNoAccessError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error)) return false;
  return error.status === 401 || error.status === 403 || error.status === 404;
}

/**
 * Runs an ACL probe, mapping no-access statuses to `false` and rethrowing anything operational.
 *
 * `check` MUST throw to report failure; its resolved value is never inspected. A bare `fetch` would
 * therefore wrongly report access for a 403 because `fetch` resolves for HTTP errors.
 */
export async function probeAccess(check: () => Promise<unknown>): Promise<boolean> {
  try {
    await check();
    return true;
  } catch (error) {
    if (isNoAccessError(error)) return false;
    throw error;
  }
}
