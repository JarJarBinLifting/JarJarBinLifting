export interface ModelOption {
  id: string;
  label: string;
  note: string;
}

// A tutor session fires 10+ LLM calls (story, ~8 concept-feedback calls,
// flashcards, QCM, Socratic turns, exercise + correction), so model choice
// has a real cost/latency impact across a session, not just per-call.
export const MODEL_OPTIONS: ModelOption[] = [
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", note: "Recommandé — bon équilibre qualité / coût" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", note: "Le plus capable, plus cher — pour privilégier la qualité" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", note: "Le plus rapide et économique" },
];

export const DEFAULT_MODEL = MODEL_OPTIONS[0].id;
