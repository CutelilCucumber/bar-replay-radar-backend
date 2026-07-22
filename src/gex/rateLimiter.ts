/**
 * Minimal logger shape — matches Fastify's `fastify.log` (pino) without importing
 * pino/fastify types directly, so this class stays usable outside a Fastify context
 * (e.g. a standalone script) if that's ever useful.
 */
export interface RateLimiterLogger {
  debug(obj: Record<string, unknown>, msg: string): void;
}

export interface RateLimiterSnapshot {
  tokensAvailable: number;
  capacity: number;
}

/**
 * Token bucket matching gex's stated policy: starts with 300 requests, refills 60/min
 * (.5/sec) up to 300, max 1 concurrent request. Same algorithm as the client-side
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
    private readonly logger?: RateLimiterLogger,
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
        this.logger?.debug(
          { tokensAvailable: Math.floor(this.tokens), capacity: this.capacity },
          "[rateLimiter] acquired",
        );
        return;
      }

      const waitMs = ((1 - this.tokens) / this.refillPerSec) * 1000;
      this.logger?.debug(
        { tokensAvailable: this.tokens, waitMs: Math.round(waitMs) },
        "[rateLimiter] throttled — waiting for refill",
      );
      await new Promise((resolve) => setTimeout(resolve, Math.max(50, waitMs)));
    }
  }

  /**
   * Read-only view of current bucket state, WITHOUT consuming a token — for periodic
   * "how close to the limit are we" logging (e.g. once per sweep), as opposed to
   * acquire()'s per-request debug logs.
   */
  getSnapshot(): RateLimiterSnapshot {
    const elapsed = (Date.now() - this.lastRefill) / 1000;
    const tokensAvailable = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    return { tokensAvailable: Math.floor(tokensAvailable), capacity: this.capacity };
  }
}