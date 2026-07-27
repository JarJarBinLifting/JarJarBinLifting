import { useEffect, useRef, useState } from "react";
import * as api from "../../lib/api";
import type { ConceptProgress, DueFlashcard } from "../../lib/types";
import { Spin } from "./common";
import { SourceExcerpt } from "../SourceExcerpt";

type ReviewPlan = {
  cards: DueFlashcard[];
  primary: ConceptProgress | null;
  contrast: ConceptProgress | null;
  primaryCard: DueFlashcard | undefined;
  contrastCard: DueFlashcard | undefined;
};

const conceptKey = (chapterId: number, conceptId: string | null) => `${chapterId}:${conceptId ?? "general"}`;

function buildReviewPlan(cards: DueFlashcard[], concepts: ConceptProgress[]): ReviewPlan {
  const cardFor = (concept: ConceptProgress) => cards.find((card) => conceptKey(card.chapter_id, card.concept_id) === conceptKey(concept.chapter_id, concept.concept_id));
  const primary = concepts.find((concept) => concept.due_cards > 0 && cardFor(concept)) ?? null;
  const primaryCard = primary ? cardFor(primary) : cards[0];
  const primaryKey = primaryCard ? conceptKey(primaryCard.chapter_id, primaryCard.concept_id) : null;

  // Prefer another notion from the same lesson: it creates a useful contrast
  // between nearby rules. Fall back to any other due notion when necessary.
  const isDifferentDueConcept = (concept: ConceptProgress) => concept.due_cards > 0
    && Boolean(cardFor(concept))
    && conceptKey(concept.chapter_id, concept.concept_id) !== primaryKey;
  const contrast = primary
    ? concepts.find((concept) => concept.chapter_id === primary.chapter_id && isDifferentDueConcept(concept))
      ?? concepts.find(isDifferentDueConcept)
      ?? null
    : null;
  const contrastCard = contrast ? cardFor(contrast) : cards.find((card) => conceptKey(card.chapter_id, card.concept_id) !== primaryKey);

  const leading = [primaryCard, contrastCard].filter((card): card is DueFlashcard => Boolean(card));
  const chosen = new Set(leading.map((card) => card.id));
  return { cards: [...leading, ...cards.filter((card) => !chosen.has(card.id))], primary, contrast, primaryCard, contrastCard };
}

function conceptName(concept: ConceptProgress | null, card: DueFlashcard | undefined): string | null {
  if (concept?.concept_label) return concept.concept_label;
  if (card?.concept_id) return `Notion ${card.concept_id}`;
  return card?.chapter_name ?? null;
}

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
  const [plan, setPlan] = useState<ReviewPlan | null>(null);
  const [comparisonAttempt, setComparisonAttempt] = useState("");
  const [comparisonRevealed, setComparisonRevealed] = useState(false);
  const [comparisonDone, setComparisonDone] = useState(false);
  const preparingPlan = plan === null;
  const reviewCards = plan?.cards ?? [];
  const card: DueFlashcard | undefined = reviewCards[idx];
  const done = !preparingPlan && idx >= reviewCards.length;
  const comparisonPending = Boolean(plan?.primaryCard && plan?.contrastCard && !comparisonDone);
  // Grading is fire-and-verify: the guard ref (not just state) prevents a
  // double keypress from grading the same card twice before React re-renders.
  const gradingRef = useRef(false);

  useEffect(() => {
    let active = true;
    setPlan(null);
    setComparisonAttempt("");
    setComparisonRevealed(false);
    setComparisonDone(false);
    api.listConceptProgress()
      .then((concepts) => { if (active) setPlan(buildReviewPlan(cards, concepts)); })
      // A review must remain usable if the progress endpoint is briefly down.
      .catch(() => { if (active) setPlan(buildReviewPlan(cards, [])); });
    return () => { active = false; };
  }, [cards]);

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
      if (preparingPlan || comparisonPending) return;
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
  }, [revealed, done, idx, attempt, preparingPlan, comparisonPending]);

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
        {preparingPlan ? (
          <Spin text="Préparation du plan de rappel par notion…" />
        ) : comparisonPending && plan?.primaryCard && plan?.contrastCard ? (
          <div style={{ padding: "4px 0" }}>
            <div className="section-kicker" style={{ color: "var(--accent-purple)", marginBottom: 8 }}>Confusion à clarifier</div>
            <h3 style={{ fontFamily: "var(--font-story)", fontSize: 20, color: "var(--text)", margin: "0 0 8px" }}>
              Distingue ces deux notions avant de revoir les règles
            </h3>
            <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.55, margin: "0 0 14px" }}>
              Explique de mémoire ce qui sépare <strong>{conceptName(plan.primary, plan.primaryCard)}</strong> et <strong>{conceptName(plan.contrast, plan.contrastCard)}</strong>. C'est la comparaison active qui évite de reconnaître une règle sans savoir quand l'appliquer.
            </p>
            {!comparisonRevealed ? (
              <>
                <textarea
                  value={comparisonAttempt}
                  onChange={(event) => setComparisonAttempt(event.target.value)}
                  rows={3}
                  autoFocus
                  placeholder="La différence décisive selon moi…"
                  style={{ width: "100%", boxSizing: "border-box", background: "var(--input)", color: "var(--text)", border: "1px solid var(--input-border)", borderRadius: 2, padding: 10, font: "inherit", fontSize: 13, lineHeight: 1.5, marginBottom: 10 }}
                />
                <button className="primary-button" disabled={!comparisonAttempt.trim()} style={{ width: "100%" }} onClick={() => setComparisonRevealed(true)}>
                  Comparer avec les deux règles
                </button>
              </>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginBottom: 12 }}>
                  {[
                    { card: plan.primaryCard, concept: plan.primary, color: "var(--accent-purple)" },
                    { card: plan.contrastCard, concept: plan.contrast, color: "var(--accent-cyan)" },
                  ].map(({ card: comparedCard, concept, color }) => (
                    <div key={comparedCard.id} style={{ background: "var(--card2)", border: "1px solid var(--border)", borderTop: `3px solid ${color}`, borderRadius: 2, padding: "10px 11px" }}>
                      <div style={{ fontSize: 10, color, fontWeight: 800, letterSpacing: .6, textTransform: "uppercase", marginBottom: 5 }}>{conceptName(concept, comparedCard)}</div>
                      <div style={{ color: "var(--text)", fontSize: 12, lineHeight: 1.55 }}>{comparedCard.answer}</div>
                    </div>
                  ))}
                </div>
                <p style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.5, margin: "0 0 12px" }}>
                  Repère le critère qui fait basculer d'une règle à l'autre, puis garde-le en tête pendant le QCM : les distracteurs s'appuient souvent sur cette confusion.
                </p>
                <button className="primary-button" style={{ width: "100%" }} onClick={() => setComparisonDone(true)}>
                  Commencer la révision ciblée
                </button>
              </>
            )}
          </div>
        ) : done ? (
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
                {idx + 1} / {reviewCards.length}
              </div>
            </div>
            <div style={{ height: 4, background: "var(--track)", borderRadius: 4, overflow: "hidden", marginBottom: 18 }}>
              <div className="pfill" style={{ width: `${(idx / reviewCards.length) * 100}%`, height: "100%", background: "var(--accent-blue)" }} />
            </div>

            {plan.primaryCard && (
              <div style={{ background: "var(--card2)", border: "1px solid var(--border)", borderLeft: "3px solid var(--accent-purple)", borderRadius: 2, padding: "9px 11px", marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: "var(--accent-purple)", fontWeight: 800, letterSpacing: .7, textTransform: "uppercase", marginBottom: 3 }}>Plan du jour par notion</div>
                <div style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.5 }}>
                  <strong>1. Sécuriser :</strong> {conceptName(plan.primary, plan.primaryCard)}
                  {plan.contrastCard && <><br /><strong>2. Alterner avec :</strong> {conceptName(plan.contrast, plan.contrastCard)}</>}
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.45, marginTop: 4 }}>Une notion fragile, puis une autre règle : l'alternance évite le faux sentiment de maîtrise.</div>
              </div>
            )}

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
                <SourceExcerpt reference={card.source_ref} />
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
