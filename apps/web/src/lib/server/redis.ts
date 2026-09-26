import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Upstash Redis: rate limits, sync idempotency keys and short locks. It is an accelerator,
 * never the source of truth - if Redis is unreachable every helper fails open and Postgres
 * constraints (sync_events primary key, unique plan versions) still guarantee correctness.
 */
let redis: Redis | null = null;
export function kv(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  redis ??= new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
  return redis;
}

const limiters = new Map<string, Ratelimit>();
function limiter(name: string, tokens: number, window: `${number} s` | `${number} m`) {
  const r = kv();
  if (!r) return null;
  const key = `${name}:${tokens}:${window}`;
  let l = limiters.get(key);
  if (!l) {
    l = new Ratelimit({ redis: r, limiter: Ratelimit.slidingWindow(tokens, window), prefix: `wp:rl:${name}` });
    limiters.set(key, l);
  }
  return l;
}

/** true = allowed. */
export async function rateLimit(name: string, id: string, tokens = 60, window: `${number} s` | `${number} m` = "60 s") {
  try {
    const l = limiter(name, tokens, window);
    if (!l) return true;
    const { success } = await l.limit(id);
    return success;
  } catch (e) {
    console.warn("[redis] rate limit unavailable, allowing", e instanceof Error ? e.message : e);
    return true;
  }
}

/**
 * Claims an idempotency key for `ttlSec`. Returns false if another request already holds it
 * (e.g. the same outbox batch replayed twice in parallel after reconnecting).
 */
export async function claim(key: string, ttlSec = 120): Promise<boolean> {
  try {
    const r = kv();
    if (!r) return true;
    const ok = await r.set(`wp:idem:${key}`, "1", { nx: true, ex: ttlSec });
    return ok === "OK";
  } catch {
    return true;
  }
}

export async function release(key: string) {
  try {
    await kv()?.del(`wp:idem:${key}`);
  } catch {
    /* expires anyway */
  }
}
