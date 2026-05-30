// Token bucket per behavior key, plus a global hourly cap.

interface Bucket {
  cooldownMs: number;
  lastAt: number;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private hourlyHits: number[] = [];
  constructor(private maxPerHour: number) {}

  setCooldown(key: string, ms: number) {
    this.buckets.set(key, { cooldownMs: ms, lastAt: 0 });
  }

  /** Returns true if the action is allowed; consumes the slot on `true`. */
  tryConsume(key: string, countAgainstHourly = true): boolean {
    const now = Date.now();
    if (countAgainstHourly) {
      this.hourlyHits = this.hourlyHits.filter((t) => now - t < 3_600_000);
      if (this.hourlyHits.length >= this.maxPerHour) return false;
    }
    const b = this.buckets.get(key);
    if (b) {
      if (now - b.lastAt < b.cooldownMs) return false;
      b.lastAt = now;
    }
    if (countAgainstHourly) this.hourlyHits.push(now);
    return true;
  }
}
