import { Redis } from '@upstash/redis';
import { env } from './env';

export const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

/**
 * Safe cache get — returns null on Redis failure (cache is a performance layer, not required)
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    return await redis.get<T>(key);
  } catch (err) {
    console.warn(`[Redis] GET failed for key "${key}":`, err);
    return null;
  }
}

/**
 * Safe cache set — silently fails on Redis error
 */
export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    await redis.set(key, value, { ex: ttlSeconds });
  } catch (err) {
    console.warn(`[Redis] SET failed for key "${key}":`, err);
  }
}

/**
 * Safe cache delete — silently fails on Redis error
 */
export async function cacheDel(...keys: string[]): Promise<void> {
  try {
    if (keys.length > 0) await redis.del(...keys);
  } catch (err) {
    console.warn(`[Redis] DEL failed for keys "${keys.join(', ')}":`, err);
  }
}

// Cache key factories — centralised to prevent key typos
export const CacheKeys = {
  tracking: (trackingNumber: string) => `tracking:${trackingNumber}`,
  shipmentTracking: (shipmentId: string) => `shipment:tracking:${shipmentId}`,
  pricingCalculate: (key: string) => `pricing:calc:${key}`,
  adminStats: () => 'admin:stats',
  bkashToken: () => 'bkash:token',
};
