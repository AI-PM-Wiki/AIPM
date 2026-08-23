/**
 * 每 IP 滑动窗口限流 + 并发信号量。
 * IP 先 sha256 哈希再存储,不落原始 IP。
 */
import { createHash } from 'node:crypto';

export function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex');
}

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly max: number;
  private readonly windowMs: number;

  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }

  /** 窗口内未超限则记录一次并放行,否则拒绝。 */
  tryAcquire(key: string): boolean {
    const now = Date.now();
    let arr = this.hits.get(key);
    if (arr === undefined) {
      arr = [];
      this.hits.set(key, arr);
    } else {
      while (arr.length > 0 && now - arr[0]! >= this.windowMs) arr.shift();
    }
    if (arr.length >= this.max) return false;
    arr.push(now);
    this.prune();
    return true;
  }

  /** 惰性清理:条目数超阈值时清掉已过期 key,防恶意 IP 池打爆内存。 */
  private prune(): void {
    if (this.hits.size < 100_000) return;
    const now = Date.now();
    for (const [key, arr] of this.hits) {
      while (arr.length > 0 && now - arr[0]! >= this.windowMs) arr.shift();
      if (arr.length === 0) this.hits.delete(key);
    }
  }

  /** 下次可放行前还需等待的秒数(仅用于 Retry-After 提示)。 */
  retryAfterSec(): number {
    return Math.max(1, Math.ceil(this.windowMs / 1000));
  }
}

/** 非阻塞信号量:满则拒绝(503),由调用方决定 Retry-After。 */
export class Semaphore {
  private active = 0;
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  /** 成功返回 release 函数;满返回 null。 */
  tryAcquire(): (() => void) | null {
    if (this.active >= this.limit) return null;
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active = Math.max(0, this.active - 1);
    };
  }

  get activeCount(): number {
    return this.active;
  }
}
