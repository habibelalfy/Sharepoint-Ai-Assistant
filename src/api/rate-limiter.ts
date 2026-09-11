/**
 * Sliding-window rate limiter (per key), used by the Phase 6 HTTP gateway.
 *
 * @module api/rate-limiter
 */

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  public constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {}

  /** Records an attempt and returns whether the key is currently allowed. */
  public allow(key: string, now: number = Date.now()): boolean {
    const windowStart = now - this.windowMs;
    const timestamps = (this.hits.get(key) ?? []).filter((t) => t > windowStart);
    if (timestamps.length >= this.maxRequests) {
      this.hits.set(key, timestamps);
      return false;
    }
    timestamps.push(now);
    this.hits.set(key, timestamps);
    return true;
  }
}
