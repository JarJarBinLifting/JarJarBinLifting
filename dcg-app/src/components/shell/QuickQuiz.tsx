import { useEffect, useRef, useState } from "react";
import * as api from "../../lib/api";
import type { DueQuizItem, QuizAnswerResult } from "../../lib/types";

/** Quiz éclair: re-asks previously-missed QCM questions from the bank, one
 * at a time, graded server-side (the correct answer never reaches the client
 * before you commit to a choice). Zero LLM calls — every question was
 * generated and paid for in a past tutor session. */
export function QuickQuiz({ items, total, onClose }: { items: DueQuizItem[]; total: number; onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  const [choice, setChoice] = useState<number | null>(null);
  const [verdict, setVerdict] = useState<QuizAnswerResult | null>(null);
  const [right, setRight] = useState(0);
  const answeringRef = useRef(false);
  const item: DueQuizItem | undefined = items[idx];
  const done = idx >= items.length;

  const answer = async (selected: number) => {
    if (answeringRef.current || verdict || !item) return;
    answeringRef.current = true;
    setChoice(selected);
    try {
      const result = await api.answerQuizItem(item.id, selected);
      setVerdict(result);
      if (result.was_correct) setRight((r) => r + 1);
    } catch {
      setChoice(null); // grading failed (e.g. server hiccup) — allow retry
    } finally {
      answeringRef.current = false;
    }
  };

  const next = () => {
    setChoice(null);
    setVerdict(null);
    setIdx((i) => i + 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (done) {
        if (e.key === "Enter" || e.key === " ") onClose();
        return;
      }
      if (verdict && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        next();
        return;
      }
      if (!verdict && item) {
        const n = Number(e.key);
        if (n >= 1 && n <= item.options.length) answer(n - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verdict, done, idx]);

  const remaining = total - items.length;

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.72)", padding: 16 }}
    >
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 600, width: "100%", maxHeight: "90vh", overflowY: "auto", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 3, padding: 24 }}
      >
        {done ? (
          <div style={{ textAlign: "center", padding: "18px 4px" }}>
            <div className="section-kicker" style={{ marginBottom: 10 }}>Quiz éclair terminé</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 30, color: "var(--text)", marginBottom: 8 }}>
              {right}/{items.length} bonnes réponses
            </div>
            <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 6 }}>
              {right === items.length
                ? "Toutes reprises — ces questions s'espacent maintenant dans le temps."
                : "Les questions ratées reviennent dès demain ; les autres s'espacent."}
            </p>
            {remaining > 0 && (
              <p style={{ color: "var(--muted)", fontSize: 12, marginBottom: 14 }}>
                Encore {remaining} question{remaining > 1 ? "s" : ""} en attente pour demain.
              </p>
            )}
            <button className="primary-button" style={{ marginTop: 10, minWidth: 180 }} onClick={onClose}>
              Fermer
            </button>
          </div>
        ) : item ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <div className="section-kicker">Quiz éclair</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)" }}>
                {idx + 1} / {items.length}
              </div>
            </div>
            <div style={{ height: 4, background: "var(--track)", borderRadius: 4, overflow: "hidden", marginBottom: 18 }}>
              <div className="pfill" style={{ width: `${(idx / items.length) * 100}%`, height: "100%", background: "var(--accent-cyan)" }} />
            </div>

            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.8, color: item.ue_color ?? "var(--muted)", textTransform: "uppercase", marginBottom: 8 }}>
              {item.ue_code} · {item.chapter_name}
              {item.theme ? ` · ${item.theme}` : ""}
            </div>
            <div style={{ fontFamily: "var(--font-story)", fontSize: 16, lineHeight: 1.55, color: "var(--text)", marginBottom: 16 }}>
              {item.question}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: verdict ? 16 : 4 }}>
              {item.options.map((option, i) => {
                const isChoice = choice === i;
                const isCorrect = verdict !== null && verdict.correct === i;
                const isWrongPick = verdict !== null && isChoice && !verdict.was_correct;
                return (
                  <button
                    key={i}
                    disabled={verdict !== null}
                    onClick={() => answer(i)}
                    style={{
                      textAlign: "left",
                      padding: "11px 13px",
                      borderRadius: 2,
                      fontSize: 13,
                      lineHeight: 1.5,
                      color: "var(--text)",
                      background: isCorrect
                        ? "color-mix(in srgb, var(--accent-green) 14%, var(--card2))"
                        : isWrongPick
                          ? "color-mix(in srgb, var(--accent-red) 12%, var(--card2))"
                          : "var(--card2)",
                      border: `1px solid ${isCorrect ? "var(--accent-green)" : isWrongPick ? "var(--accent-red)" : "var(--border)"}`,
                      cursor: verdict ? "default" : "pointer",
                    }}
                  >
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)", marginRight: 8 }}>{i + 1}</span>
                    {option}
                  </button>
                );
              })}
            </div>

            {verdict && (
              <>
                <div
                  style={{
                    background: "var(--card2)",
                    border: "1px solid var(--border)",
                    borderLeft: `3px solid ${verdict.was_correct ? "var(--accent-green)" : "var(--accent-red)"}`,
                    borderRadius: 2,
                    padding: "11px 13px",
                    fontSize: 13,
                    lineHeight: 1.6,
                    color: "var(--text)",
                    marginBottom: 14,
                  }}
                >
                  <strong style={{ color: verdict.was_correct ? "var(--accent-green)" : "var(--accent-red)" }}>
                    {verdict.was_correct ? "Exact." : "Raté."}
                  </strong>{" "}
                  {verdict.explication ?? ""}
                </div>
                <button className="primary-button" style={{ width: "100%" }} onClick={next}>
                  {idx + 1 >= items.length ? "Voir le résultat" : "Question suivante (entrée)"}
                </button>
              </>
            )}

            <div style={{ marginTop: 12, textAlign: "center" }}>
              <button className="text-action" onClick={onClose} style={{ color: "var(--muted)" }}>
                Reprendre plus tard — chaque réponse est déjà comptée
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
