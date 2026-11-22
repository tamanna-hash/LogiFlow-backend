/**
 * gemini.ts — Google Gemini SDK wrapper.
 *
 * Lazy singleton so the server starts normally when GEMINI_API_KEY is not
 * configured. All AI operations call getGemini() first, which throws a
 * ServiceUnavailableError with a clear message when the key is absent.
 *
 * SECURITY:
 *  - GEMINI_API_KEY stays server-side only — never sent to the browser,
 *    never in NEXT_PUBLIC_* env vars, never logged.
 *  - No data is sent to Gemini before access control is verified by
 *    the calling service.
 */

import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai';
import { env } from '../config/env';
import { ServiceUnavailableError } from '../errors';

let _model: GenerativeModel | null = null;

export function isGeminiConfigured(): boolean {
  return !!env.GEMINI_API_KEY;
}

export function getGemini(): GenerativeModel {
  if (_model) return _model;

  if (!env.GEMINI_API_KEY) {
    throw new ServiceUnavailableError(
      'AI investigation is not configured. Set GEMINI_API_KEY to enable this feature.',
    );
  }

  const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

  _model = genAI.getGenerativeModel({
    model: INVESTIGATION_MODEL,
    generationConfig: {
      responseMimeType: 'application/json', // structured JSON output
      temperature: 0.2,                     // low temperature — consistent, factual analysis
      maxOutputTokens: MAX_INVESTIGATION_TOKENS,
    },
  });

  return _model;
}

/** Gemini model for all shipment investigations. Free tier supports this. */
export const INVESTIGATION_MODEL = 'gemini-1.5-flash' as const;

/** Hard output cap — a full investigation fits well within 2000 tokens. */
export const MAX_INVESTIGATION_TOKENS = 2000;

// ── Test helper ───────────────────────────────────────────────────────────────

export function _resetGeminiClient(): void {
  _model = null;
}
