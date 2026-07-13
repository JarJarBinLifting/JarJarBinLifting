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

/** Free-text generation (Socratic chat, feedback, corrections chat). */
export async function genText(system: string, content: unknown, maxTokens = 4096): Promise<string> {
  const messages: AnthropicMessageInput[] = [{ role: "user", content }];
  const r = await api.callAnthropic(system, messages, maxTokens);
  return r.text;
}

/** Same as genText but conversational (multi-turn) — content is the full transcript. */
export async function genChat(system: string, messages: AnthropicMessageInput[], maxTokens = 1000): Promise<string> {
  const r = await api.callAnthropic(system, messages, maxTokens);
  return r.text;
}

/** JSON generation with up to 3 retries on malformed output, matching the
 * resilience the original prototype needed since the model doesn't always
 * come back with clean JSON on the first try. */
export async function genJson<T = any>(system: string, content: unknown, maxTokens = 4096): Promise<T> {
  let lastErr = "";
  for (let i = 0; i < 3; i++) {
    try {
      const raw = await genText(system, content, maxTokens);
      const parsed = safeParse(raw);
      if (parsed.ok) return parsed.data as T;
      lastErr = "JSON invalide";
    } catch (e: any) {
      lastErr = e?.message ?? String(e);
    }
  }
  throw new Error(lastErr || "Échec après 3 tentatives");
}
