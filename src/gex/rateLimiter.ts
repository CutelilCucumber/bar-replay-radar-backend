/**
 * Token bucket matching gex's stated policy: starts with 300 requests, refills 60/min
 * (1/sec) up to 300, max 1 concurrent request. Same algorithm as the client-side
 * RateLimiter in matchData.js — ported as-is, since the logic was already correct and
 * this is exactly the kind of shared-mutable-state resource that must be a single
 * instance decorated onto the Fastify app (see plugins/gexClient.ts), not one per caller.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      const elapsed = (now - this.lastRefill) / 1000;
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
      this.lastRefill = now;

      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }

      const waitMs = ((1 - this.tokens) / this.refillPerSec) * 1000;
      await new Promise((resolve) => setTimeout(resolve, Math.max(50, waitMs)));
    }
  }
}