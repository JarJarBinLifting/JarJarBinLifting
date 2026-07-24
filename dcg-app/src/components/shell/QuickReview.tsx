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
  const [attempt, setAttempt] = useState("");
  const [known, setKnown] = useState(0);
  const [saving, setSaving] = useState(false);
  const card: DueFlashcard | undefined = cards[idx];
  const done = idx >= cards.length;
  // Grading is fire-and-verify: the guard ref (not just state) prevents a
  // double keypress from grading the same card twice before React re-renders.
  const gradingRef = useRef(false);

  const grade = async (quality: number) => {
    if (gradingRef.current || !card) return;
    gradingRef.current = true;
    setSaving(true);
    try {
      await api.updateFlashcardProgress(card.id, quality);
      if (quality >= 3) setKnown((k) => k + 1);
      setRevealed(false);
      setAttempt("");
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
      if (!revealed && attempt.trim() && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && /^[0-5]$/.test(e.key)) {
        grade(Number(e.key));
      } else if (revealed && e.key === "ArrowRight") {
        grade(4);
      } else if (revealed && e.key === "ArrowLeft") {
        grade(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed, done, idx, attempt]);

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
                ? "Sans faute — SM‑2 espacera chaque carte jusqu'au prochain rappel utile."
                : "Les cartes mal rappelées reviennent demain ; les autres s'espacent selon la qualité de ton rappel."}
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
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>
              SM‑2 · {card.sm2_repetitions} rappel{card.sm2_repetitions > 1 ? "s" : ""} réussi{card.sm2_repetitions > 1 ? "s" : ""}
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
                <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5, margin: "0 0 9px" }}>
                  Compare avec ta réponse, puis note honnêtement la qualité de ton rappel.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 6 }}>
                  {[
                    { quality: 0, label: "Oubliée", hint: "Aucun rappel" },
                    { quality: 2, label: "Difficile", hint: "Avec effort" },
                    { quality: 3, label: "Hésitante", hint: "Presque juste" },
                    { quality: 4, label: "Bonne", hint: "Juste" },
                    { quality: 5, label: "Évidente", hint: "Immédiate" },
                  ].map((rating) => (
                    <button
                      key={rating.quality}
                      className={rating.quality >= 3 ? "primary-button" : "soft-button"}
                      disabled={saving}
                      onClick={() => grade(rating.quality)}
                      title={`Qualité SM‑2 ${rating.quality} : ${rating.hint}`}
                      style={{ minHeight: 55, padding: "7px 4px", fontSize: 10, lineHeight: 1.15, color: rating.quality < 3 ? "var(--accent-red)" : undefined }}
                    >
                      <b style={{ display: "block", fontSize: 12 }}>{rating.quality}</b>
                      {rating.label}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: "var(--muted)", textAlign: "center", marginTop: 8 }}>Touches 0–5 · 0–2 relancent la carte, 3–5 l'espacent.</div>
              </>
            ) : (
              <>
                <label style={{ display: "block", fontSize: 12, color: "var(--muted)", lineHeight: 1.5, marginBottom: 8 }}>
                  Formule d'abord ta réponse — un mot-clé suffit. C'est le rappel actif qui fixe la règle.
                </label>
                <textarea
                  value={attempt}
                  onChange={(event) => setAttempt(event.target.value)}
                  rows={2}
                  autoFocus
                  placeholder="Ma réponse / mon raisonnement…"
                  style={{ width: "100%", boxSizing: "border-box", background: "var(--input)", color: "var(--text)", border: "1px solid var(--input-border)", borderRadius: 2, padding: 10, font: "inherit", fontSize: 13, lineHeight: 1.5, marginBottom: 10 }}
                />
                <button className="primary-button" disabled={!attempt.trim()} style={{ width: "100%" }} onClick={() => setRevealed(true)}>
                  Comparer avec la réponse (espace)
                </button>
              </>
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
