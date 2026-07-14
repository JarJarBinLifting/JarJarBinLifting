import { useEffect, useMemo, useState } from "react";
import * as api from "../../../lib/api";
import type { ConceptConfidence, FlashcardRow } from "../../../lib/types";
import { Consigne } from "../shared";

export function FlashcardsPhase({
  cards: initialCards,
  confidences,
  adhd,
  onDone,
  onHint,
  celebrate,
  breakStreak,
}: {
  cards: FlashcardRow[];
  confidences: ConceptConfidence[];
  adhd: boolean;
  onDone: (fails: number, total: number) => void;
  onHint: (hint: string) => void;
  celebrate: (emoji: string) => void;
  breakStreak: () => void;
}) {
  const orderedCards = useMemo(() => {
    // First-time sessions have fresh Découverte confidence ratings to order
    // by. Revision sessions skip Découverte entirely, so there's nothing in
    // `confidences` — fall back to ordering by demonstrated mastery instead
    // (least-mastered first), which is exactly what a targeted revision pass
    // should prioritize anyway.
    if (confidences.length) {
      const confByStep: Record<number, number> = {};
      confidences.forEach((c) => {
        confByStep[c.step + 1] = c.val;
      });
      return [...initialCards].sort((a, b) => {
        const ca = confByStep[Number(a.concept_id)] ?? 2;
        const cb = confByStep[Number(b.concept_id)] ?? 2;
        return ca - cb;
      });
    }
    return [...initialCards].sort((a, b) => {
      if (a.mastered !== b.mastered) return a.mastered ? 1 : -1;
      return a.box_level - b.box_level;
    });
  }, [initialCards, confidences]);

  const [cardsState, setCardsState] = useState<Record<number, FlashcardRow>>(() =>
    Object.fromEntries(orderedCards.map((c) => [c.id, c])),
  );
  const [queue, setQueue] = useState<number[]>(() => orderedCards.map((c) => c.id));
  const [cur, setCur] = useState(0);
  const [flip, setFlip] = useState(false);
  const [fails, setFails] = useState(0);
  const [busy, setBusy] = useState(false);

  const total = orderedCards.length;
  const mastered = Object.values(cardsState).filter((c) => c.mastered).length;
  const allDone = total > 0 && mastered >= total;

  useEffect(() => {
    onHint(`Mémorisation — ${mastered}/${total} flashcards maîtrisées`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mastered, total]);

  if (!total) {
    return (
      <div className="tutor-card" style={{ textAlign: "center" }}>
        <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>Pas de flashcards disponibles pour ce chapitre.</p>
        <button className="tutor-bp" onClick={() => onDone(0, 0)}>
          Continuer →
        </button>
      </div>
    );
  }

  const advance = async (knew: boolean) => {
    if (busy) return;
    const id = queue[cur];
    setBusy(true);
    try {
      const updated = await api.updateFlashcardProgress(id, knew);
      setCardsState((p) => ({ ...p, [id]: updated }));
      setFlip(false);
      if (!knew) {
        setFails((f) => f + 1);
        breakStreak();
      } else {
        celebrate("🃏");
      }

      let nq = [...queue];
      if (knew && updated.mastered) {
        nq = nq.filter((_, i) => i !== cur);
      } else if (!knew) {
        const [item] = nq.splice(cur, 1);
        nq.push(item);
      } else {
        setCur((c) => (c < nq.length - 1 ? c + 1 : 0));
        setQueue(nq);
        setBusy(false);
        return;
      }
      if (nq.length) setCur((c) => (c >= nq.length ? 0 : c));
      setQueue(nq);
    } finally {
      setBusy(false);
    }
  };

  const c = cardsState[queue[cur]] ?? cardsState[queue[0]];

  return (
    <div className="tutor-card">
      <div style={{ textAlign: "center", marginBottom: 12 }}>
        <h3 style={{ fontFamily: "var(--font-story)", fontSize: 17, color: "var(--t-pri)", marginBottom: 6 }}>Mémorisation — Flashcards</h3>
        <p style={{ fontSize: 12, color: "var(--muted)" }}>Les concepts où tu étais le moins sûr arrivent en premier</p>
      </div>
      <Consigne text="Touche la carte pour la retourner, puis évalue-toi honnêtement" />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, justifyContent: "center" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: allDone ? "var(--t-ok)" : "var(--t-pri)", fontFamily: "var(--font-mono)" }}>
          {mastered}/{total}
        </span>
        <div style={{ flex: 1, maxWidth: 200, background: "var(--track)", borderRadius: 2, height: 6, overflow: "hidden" }}>
          <div className="pfill" style={{ width: `${(mastered / total) * 100}%`, height: "100%", background: allDone ? "var(--t-ok)" : "var(--t-pri)" }} />
        </div>
      </div>
      {allDone ? (
        <div style={{ textAlign: "center", padding: 20 }}>
          <p style={{ fontSize: 15, fontWeight: 600, color: "var(--t-ok)", marginBottom: 16 }}>Toutes maîtrisées !</p>
          <button className="tutor-bp" onClick={() => onDone(fails, total)}>
            Vérification →
          </button>
        </div>
      ) : (
        c && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
            <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
              {queue.length} restante{queue.length > 1 ? "s" : ""}
              {adhd && ` · ~${Math.max(1, Math.ceil(queue.length * 0.4))} min`}
            </span>
            <div className={`tutor-fc ${flip ? "tutor-fc-b" : "tutor-fc-f"}`} onClick={() => setFlip(!flip)}>
              <span style={{ position: "absolute", top: 8, right: 12, fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>
                {flip ? "Réponse" : "Question"}
              </span>
              <p style={{ fontSize: 15, lineHeight: 1.65, textAlign: "center", margin: 0, fontFamily: flip ? "var(--font-body)" : "var(--font-story)" }}>{flip ? c.answer : c.question}</p>
              {!flip && <span style={{ marginTop: 12, fontSize: 11, color: "var(--muted)" }}>Cliquer pour retourner</span>}
            </div>
            {flip && (
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  disabled={busy}
                  onClick={() => advance(false)}
                  style={{ padding: "9px 20px", borderRadius: 2, border: "1px solid var(--t-err)", background: "var(--t-erb)", color: "var(--t-err)", fontSize: 13, fontWeight: 600 }}
                >
                  ✗ À revoir
                </button>
                <button
                  disabled={busy}
                  onClick={() => advance(true)}
                  style={{ padding: "9px 20px", borderRadius: 2, border: "1px solid var(--t-ok)", background: "var(--t-okb)", color: "var(--t-ok)", fontSize: 13, fontWeight: 600 }}
                >
                  ✓ OK
                </button>
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}
