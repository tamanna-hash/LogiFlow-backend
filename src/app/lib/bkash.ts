import { env } from '../config/env';
import { ServiceUnavailableError } from '../errors';
import { redis, CacheKeys } from './redis';

const BASE = env.BKASH_BASE_URL;

const GRANT_TOKEN_URL = `${BASE}/tokenized/checkout/token/grant`;
const REFRESH_TOKEN_URL = `${BASE}/tokenized/checkout/token/refresh`;
const CREATE_PAYMENT_URL = `${BASE}/tokenized/checkout/create`;
const EXECUTE_PAYMENT_URL = `${BASE}/tokenized/checkout/execute`;
const QUERY_PAYMENT_URL = `${BASE}/tokenized/checkout/payment/status`;

const AUTH_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
  username: env.BKASH_USERNAME,
  password: env.BKASH_PASSWORD,
};

// ── Token management ──────────────────────────────────────────────────────────

/**
 * getBkashIdToken — returns a valid bKash id_token.
 * Implements the full grant/refresh/cache cycle:
 *   1. If cached idToken has > 10 min TTL → return it
 *   2. If idToken expired but refreshToken has > 10 min TTL → use refresh endpoint
 *   3. Otherwise → full grant-token flow
 * Token is cached in Upstash Redis (not in-memory) so it survives restarts.
 */
export async function getBkashIdToken(): Promise<string> {
  try {
    const idTokenKey = CacheKeys.bkashIdToken();
    const refreshTokenKey = CacheKeys.bkashRefreshToken();

    let idToken: string | null = await redis.get<string>(idTokenKey);
    const idTokenTTL: number = idToken ? await redis.ttl(idTokenKey) : 0;
    const refreshToken: string | null = await redis.get<string>(refreshTokenKey);
    const refreshTokenTTL: number = refreshToken ? await redis.ttl(refreshTokenKey) : 0;

    // Case 1: idToken still valid (> 10 min remaining)
    if (idToken && idTokenTTL > 600) {
      return idToken;
    }

    // Case 2: idToken expired/expiring but refreshToken is valid → refresh
    if (refreshToken && refreshTokenTTL > 600) {
      const response = await fetch(REFRESH_TOKEN_URL, {
        method: 'POST',
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          app_key: env.BKASH_APP_KEY,
          app_secret: env.BKASH_APP_SECRET,
          refresh_token: refreshToken,
        }),
      });

      if (!response.ok) {
        throw new ServiceUnavailableError('bKash token refresh failed');
      }

      const result = await response.json() as { id_token: string };
      idToken = result.id_token;

      await redis.set(idTokenKey, idToken, { ex: 3600 }); // 1 hour
      return idToken;
    }

    // Case 3: Full grant-token
    const response = await fetch(GRANT_TOKEN_URL, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({
        app_key: env.BKASH_APP_KEY,
        app_secret: env.BKASH_APP_SECRET,
      }),
    });

    if (!response.ok) {
      throw new ServiceUnavailableError('bKash token grant failed');
    }

    const result = await response.json() as { id_token: string; refresh_token: string };

    await redis.set(idTokenKey, result.id_token, { ex: 3600 });            // 1 hour
    await redis.set(refreshTokenKey, result.refresh_token, { ex: 60 * 60 * 24 * 28 }); // 28 days

    return result.id_token;
  } catch (err) {
    if (err instanceof ServiceUnavailableError) throw err;
    throw new ServiceUnavailableError('bKash authentication service unavailable');
  }
}

// ── Payment operations ────────────────────────────────────────────────────────

export interface BkashCreatePaymentParams {
  amount: string;            // e.g. "150.00"
  currency: string;          // "BDT"
  intent: 'sale';
  merchantInvoiceNumber: string; // our internal payment ID
}

export interface BkashCreatePaymentResult {
  paymentID: string;
  bkashURL: string;
  callbackURL: string;
  successCallbackURL: string;
  failureCallbackURL: string;
  cancelledCallbackURL: string;
  amount: string;
  currency: string;
  intent: string;
  merchantInvoiceNumber: string;
}

export async function createBkashPayment(
  params: BkashCreatePaymentParams,
): Promise<BkashCreatePaymentResult> {
  const idToken = await getBkashIdToken();

  const response = await fetch(CREATE_PAYMENT_URL, {
    method: 'POST',
    headers: {
      ...AUTH_HEADERS,
      Authorization: idToken,
      'X-APP-Key': env.BKASH_APP_KEY,
    },
    body: JSON.stringify({
      mode: '0011',                     // checkout URL mode
      payerReference: params.merchantInvoiceNumber,
      callbackURL: env.BKASH_CALLBACK_URL,
      ...params,
    }),
  });

  if (!response.ok) {
    throw new ServiceUnavailableError('bKash payment creation failed');
  }

  const result = await response.json() as BkashCreatePaymentResult & { statusCode?: string; statusMessage?: string };

  if (result.statusCode && result.statusCode !== '0000') {
    throw new ServiceUnavailableError(
      `bKash error: ${result.statusMessage ?? 'Payment creation failed'}`,
    );
  }

  return result;
}

export interface BkashExecutePaymentResult {
  paymentID: string;
  trxID: string;
  transactionStatus: string; // "Completed" on success
  amount: string;
  currency: string;
  intent: string;
  merchantInvoiceNumber: string;
  payerReference: string;
  customerMsisdn: string;
  paymentExecuteTime: string;
  statusCode: string;
  statusMessage: string;
}

export async function executeBkashPayment(
  paymentID: string,
): Promise<BkashExecutePaymentResult> {
  const idToken = await getBkashIdToken();

  const response = await fetch(EXECUTE_PAYMENT_URL, {
    method: 'POST',
    headers: {
      ...AUTH_HEADERS,
      Authorization: idToken,
      'X-APP-Key': env.BKASH_APP_KEY,
    },
    body: JSON.stringify({ paymentID }),
  });

  if (!response.ok) {
    throw new ServiceUnavailableError('bKash payment execution failed');
  }

  return response.json() as Promise<BkashExecutePaymentResult>;
}

export async function queryBkashPayment(
  paymentID: string,
): Promise<BkashExecutePaymentResult> {
  const idToken = await getBkashIdToken();

  const response = await fetch(`${QUERY_PAYMENT_URL}?paymentID=${paymentID}`, {
    method: 'GET',
    headers: {
      ...AUTH_HEADERS,
      Authorization: idToken,
      'X-APP-Key': env.BKASH_APP_KEY,
    },
  });

  if (!response.ok) {
    throw new ServiceUnavailableError('bKash payment query failed');
  }

  return response.json() as Promise<BkashExecutePaymentResult>;
}
