/**
 * Log redaction: recursively masks values whose keys look like secrets.
 *
 * @module services/log-redaction
 */

const SENSITIVE_KEY_PATTERN =
  /password|secret|token|authorization|jwt|api[-_]?key|passwd|credential|private[-_]?key/i;

/** Recursively replaces values under sensitive-looking keys with `[REDACTED]`. */
export function redactSecrets(input: unknown, depth = 0): unknown {
  if (depth > 10) {
    return '[REDACTED]';
  }
  if (Array.isArray(input)) {
    return input.map((item) => redactSecrets(item, depth + 1));
  }
  if (typeof input === 'object' && input !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      result[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? '[REDACTED]'
        : redactSecrets(value, depth + 1);
    }
    return result;
  }
  return input;
}
