export class RateLimiter {
  constructor(maxKeys = 5000) {
    this.buckets = new Map();
    this.maxKeys = maxKeys;
  }

  /** 滑动窗口：windowMs 内最多 limit 次。 */
  take(key, limit, windowMs, now = Date.now()) {
    const cutoff = now - windowMs;
    const recent = (this.buckets.get(key) ?? []).filter((time) => time > cutoff);
    if (recent.length >= limit) {
      this.buckets.set(key, recent);
      return false;
    }
    recent.push(now);
    this.buckets.set(key, recent);

    if (this.buckets.size > this.maxKeys) {
      for (const [bucketKey, times] of this.buckets) {
        const kept = times.filter((time) => time > cutoff);
        if (kept.length === 0) this.buckets.delete(bucketKey);
        else this.buckets.set(bucketKey, kept);
      }
    }
    return true;
  }
}
