/**
 * Safely turn any thrown value into a human-readable string.
 *
 * The mobile app was showing literal "[object Object]" in several places
 * because Supabase/Postgrest errors (and other non-Error rejections) were
 * being passed straight into String(err) or used directly as message text.
 * String(err) on a plain object gives "[object Object]" instead of the
 * error's actual message.
 *
 * This checks, in order: a real Error instance, a Postgrest-style object
 * with a `message` string field, a plain string, then falls back to a
 * provided default (or a generic message) rather than ever stringifying
 * an object directly.
 */
export function getErrorMessage(err: unknown, fallback?: string): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  if (typeof err === 'string' && err.trim().length > 0) {
    return err;
  }
  if (err && typeof err === 'object') {
    const maybeMessage = (err as { message?: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage.trim().length > 0) {
      return maybeMessage;
    }
    const maybeError = (err as { error?: unknown }).error;
    if (typeof maybeError === 'string' && maybeError.trim().length > 0) {
      return maybeError;
    }
  }
  return fallback ?? 'Something went wrong. Please try again.';
}
