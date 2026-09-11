import { describe, expect, it } from '@jest/globals';
import { SlidingWindowRateLimiter } from '../../src/api/rate-limiter';

describe('SlidingWindowRateLimiter', () => {
  it('allows requests up to the limit then rejects', () => {
    const limiter = new SlidingWindowRateLimiter(3, 1000);
    expect(limiter.allow('alice', 0)).toBe(true);
    expect(limiter.allow('alice', 100)).toBe(true);
    expect(limiter.allow('alice', 200)).toBe(true);
    expect(limiter.allow('alice', 300)).toBe(false);
  });

  it('slides the window so old hits expire', () => {
    const limiter = new SlidingWindowRateLimiter(2, 1000);
    expect(limiter.allow('alice', 0)).toBe(true);
    expect(limiter.allow('alice', 500)).toBe(true);
    expect(limiter.allow('alice', 900)).toBe(false);
    expect(limiter.allow('alice', 1500)).toBe(true);
  });

  it('tracks keys independently', () => {
    const limiter = new SlidingWindowRateLimiter(1, 1000);
    expect(limiter.allow('alice', 0)).toBe(true);
    expect(limiter.allow('bob', 0)).toBe(true);
    expect(limiter.allow('alice', 100)).toBe(false);
    expect(limiter.allow('bob', 100)).toBe(false);
  });
});
