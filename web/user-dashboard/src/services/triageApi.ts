// ============================================================================
// Triage API — client for the Gemini-powered natural-language triage endpoint
// ============================================================================

import { API_CONFIG } from '../config/api';

export interface ConverseMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface ConverseResult {
  available: boolean;
  reply: string;
  answers: Record<string, string>;
  quickReplies: string[];
  inputType: 'yes_no' | 'choice' | 'pain' | 'text' | 'none';
  keywords: string[];
  done: boolean;
}

/** Hard ceiling on a single LLM round-trip. Past this we abort and let the
 *  caller drop to the offline engine — an emergency intake must never hang. */
const CONVERSE_TIMEOUT_MS = 15000;

/**
 * Send the running conversation to the backend triage LLM.
 * Returns `available: false` (and the caller should fall back to the local
 * rule-based engine) if the server has no API key, the request fails, or the
 * request exceeds {@link CONVERSE_TIMEOUT_MS} (so the UI never freezes).
 */
export async function converse(messages: ConverseMessage[], lang?: string): Promise<ConverseResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONVERSE_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_CONFIG.BASE_URL}/triage/converse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, lang }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as ConverseResult;
  } catch {
    return {
      available: false,
      reply: '',
      answers: {},
      quickReplies: [],
      inputType: 'text',
      keywords: [],
      done: false,
    };
  } finally {
    clearTimeout(timer);
  }
}
