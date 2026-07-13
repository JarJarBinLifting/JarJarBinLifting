import * as api from "../../lib/api";
import type { AnthropicMessageInput } from "../../lib/api";

function safeParse(raw: string): { ok: true; data: any } | { ok: false } {
  const clean = raw.replace(/```json|```/g, "").trim();
  try {
    return { ok: true, data: JSON.parse(clean) };
  } catch {
    /* fall through to bracket-depth scan below */
  }
  let depth = 0;
  let start = -1;
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (clean[i] === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          return { ok: true, data: JSON.parse(clean.slice(start, i + 1)) };
        } catch {
          /* keep scanning for another balanced object */
        }
        start = -1;
      }
    }
  }
  const m = clean.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return { ok: true, data: JSON.parse(m[0].replace(/,\s*([\]}])/g, "$1")) };
    } catch {
      /* give up below */
    }
  }
  return { ok: false };
}

// Matches network failures and Anthropic's overloaded/rate-limit/5xx responses
// — the kind of thing that's usually gone if you just wait a moment and try
// again. Deliberately does NOT match auth/bad-request style errors (invalid
// key, malformed request), which retrying instantly won't fix — those should
// surface immediately instead of silently eating a session's worth of retries.
const RETRYABLE_PATTERN = /overloaded|rate.?limit|429|5\d\d|timeout|timed out|network|fetch|ECONNRESET|ETIMEDOUT/i;

function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return RETRYABLE_PATTERN.test(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The one place every LLM call in the tutor funnels through — so network
 * resilience (exponential backoff with jitter, on transient failures only)
 * is consistent across story/flashcard/QCM generation, feedback calls, and
 * chat turns, instead of only the JSON-parsing retry a couple of these calls
 * used to have. */
async function callWithRetry(
  system: string,
  messages: AnthropicMessageInput[],
  maxTokens: number,
  model?: string,
  retries = 3,
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await api.callAnthropic(system, messages, maxTokens, model);
      return r.text;
    } catch (e) {
      lastErr = e;
      if (attempt === retries || !isRetryable(e)) throw e;
      await sleep(1000 * 2 ** attempt + Math.random() * 300);
    }
  }
  throw lastErr;
}

/** Free-text generation (feedback, reformulation ack, recall check). */
export async function genText(system: string, content: unknown, maxTokens = 4096, model?: string): Promise<string> {
  return callWithRetry(system, [{ role: "user", content }], maxTokens, model);
}

/** Same as genText but conversational (multi-turn) — messages is the full transcript. */
export async function genChat(system: string, messages: AnthropicMessageInput[], maxTokens = 1000, model?: string): Promise<string> {
  return callWithRetry(system, messages, maxTokens, model);
}

/** JSON generation. Network/rate-limit failures are already retried with
 * backoff inside genText/callWithRetry, so a rejection here is non-transient
 * and propagates immediately — this loop's only job is retrying a *response
 * that came back but wasn't valid JSON*, which is cheap and doesn't need a
 * backoff delay. */
export async function genJson<T = any>(system: string, content: unknown, maxTokens = 4096, model?: string): Promise<T> {
  let lastErr = "";
  for (let i = 0; i < 3; i++) {
    const raw = await genText(system, content, maxTokens, model);
    const parsed = safeParse(raw);
    if (parsed.ok) return parsed.data as T;
    lastErr = "JSON invalide";
  }
  throw new Error(lastErr || "Échec après 3 tentatives");
}
