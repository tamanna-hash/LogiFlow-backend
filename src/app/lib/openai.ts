/**
 * openai.ts — OpenAI SDK wrapper.
 *
 * The OpenAI client is a lazy singleton so the server starts normally
 * even when OPENAI_API_KEY is not configured.
 *
 * All AI operations check isOpenAIConfigured() first and throw a
 * ServiceUnavailableError with a clear message when the key is absent.
 *
 * SECURITY:
 *  - OPENAI_API_KEY stays server-side only — never sent to the browser,
 *    never in NEXT_PUBLIC_* env vars, never logged.
 *  - No data is sent to OpenAI before access control is verified by
 *    the calling service.
 */

import OpenAI from 'openai';
import { env } from '../config/env';
import { ServiceUnavailableError } from '../errors';

let _openai: OpenAI | null = null;

export function isOpenAIConfigured(): boolean {
  return !!env.OPENAI_API_KEY;
}

export function getOpenAI(): OpenAI {
  if (_openai) return _openai;

  if (!env.OPENAI_API_KEY) {
    throw new ServiceUnavailableError(
      'AI investigation is not configured. Set OPENAI_API_KEY to enable this feature.',
    );
  }

  _openai = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    timeout: 30_000, // 30 s hard timeout — prevents runaway requests
    maxRetries: 1,   // one automatic retry on network/5xx; not on rate limits
  });

  return _openai;
}

/** Model used for all shipment investigations. */
export const INVESTIGATION_MODEL = 'gpt-4o-mini' as const;

/** Hard output cap — a full investigation fits well within 1000 tokens. */
export const MAX_INVESTIGATION_TOKENS = 1000;

// ── Test helper ───────────────────────────────────────────────────────────────

export function _resetOpenAIClient(): void {
  _openai = null;
}
