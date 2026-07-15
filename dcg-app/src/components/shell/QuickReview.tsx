import { useEffect, useRef, useState } from "react";
import * as api from "../../lib/api";
import type { DueFlashcard } from "../../lib/types";

/** Révision éclair: a bounded daily flip-card deck. Every card already
 * exists in the database (generated during past tutor sessions or minted
 * from the carnet d'erreurs), so this whole flow costs zero LLM calls and
 * works offline. Grading goes through the same endpoint as the Mémorisation
 * phase, so in-session and standalone reviews share one per-card schedule. */
export function QuickReview({ cards, total, onClose }: { cards: DueFlashcard[]; total: number; onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [known, setKnown] = useState(0);
  const [saving, setSaving] = useState(false);
  const card: DueFlashcard | undefined = cards[idx];
  const done = idx >= cards.length;
  // Grading is fire-and-verify: the guard ref (not just state) prevents a
  // double keypress from grading the same card twice before React re-renders.
  const gradingRef = useRef(false);

  const grade = async (correct: boolean) => {
    if (gradingRef.current || !card) return;
    gradingRef.current = true;
    setSaving(true);
    try {
      await api.updateFlashcardProgress(card.id, correct);
      if (correct) setKnown((k) => k + 1);
      setRevealed(false);
      setIdx((i) => i + 1);
    } finally {
      gradingRef.current = false;
      setSaving(false);
    }
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
      if (!revealed && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && e.key === "ArrowRight") {
        grade(true);
      } else if (revealed && e.key === "ArrowLeft") {
        grade(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed, done, idx]);

  const remaining = total - cards.length;

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.72)", padding: 16 }}
    >
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 560, width: "100%", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 3, padding: 24 }}
      >
        {done ? (
          <div style={{ textAlign: "center", padding: "18px 4px" }}>
            <div className="section-kicker" style={{ marginBottom: 10 }}>Révision éclair terminée</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 30, color: "var(--text)", marginBottom: 8 }}>
              {known}/{cards.length} retenues
            </div>
            <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 6 }}>
              {known === cards.length
                ? "Sans faute — chaque carte revient plus tard, quand tu commencerais à l'oublier."
                : "Les cartes ratées reviennent dès demain ; les autres s'espacent."}
            </p>
            {remaining > 0 && (
              <p style={{ color: "var(--muted)", fontSize: 12, marginBottom: 14 }}>
                Encore {remaining} carte{remaining > 1 ? "s" : ""} en attente — elles rempliront le paquet de demain.
              </p>
            )}
            <button className="primary-button" style={{ marginTop: 10, minWidth: 180 }} onClick={onClose}>
              Fermer
            </button>
          </div>
        ) : card ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <div className="section-kicker">Révision éclair</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)" }}>
                {idx + 1} / {cards.length}
              </div>
            </div>
            <div style={{ height: 4, background: "var(--track)", borderRadius: 4, overflow: "hidden", marginBottom: 18 }}>
              <div className="pfill" style={{ width: `${(idx / cards.length) * 100}%`, height: "100%", background: "var(--accent-blue)" }} />
            </div>

            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.8, color: card.ue_color ?? "var(--muted)", textTransform: "uppercase", marginBottom: 8 }}>
              {card.ue_code} · {card.chapter_name}
            </div>
            <div style={{ fontFamily: "var(--font-story)", fontSize: 17, lineHeight: 1.55, color: "var(--text)", minHeight: 64, marginBottom: 16 }}>
              {card.question}
            </div>

            {revealed ? (
              <>
                <div
                  style={{
                    background: "var(--card2)",
                    border: "1px solid var(--border)",
                    borderLeft: "3px solid var(--accent-blue)",
                    borderRadius: 2,
                    padding: "12px 14px",
                    fontSize: 14,
                    lineHeight: 1.6,
                    color: "var(--text)",
                    marginBottom: 18,
                  }}
                >
                  {card.answer}
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    className="soft-button"
                    disabled={saving}
                    onClick={() => grade(false)}
                    style={{ flex: 1, color: "var(--accent-red)", borderColor: "color-mix(in srgb, var(--accent-red) 45%, var(--input-border))" }}
                  >
                    ← À revoir
                  </button>
                  <button className="primary-button" disabled={saving} onClick={() => grade(true)} style={{ flex: 1 }}>
                    Je savais →
                  </button>
                </div>
              </>
            ) : (
              <button className="primary-button" style={{ width: "100%" }} onClick={() => setRevealed(true)}>
                Voir la réponse (espace)
              </button>
            )}

            <div style={{ marginTop: 14, textAlign: "center" }}>
              <button className="text-action" onClick={onClose} style={{ color: "var(--muted)" }}>
                Reprendre plus tard — la progression est déjà enregistrée
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
