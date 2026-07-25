import { useEffect, useState } from "react";
import * as api from "../../lib/api";
import type { FlashcardRow } from "../../lib/types";

type SimulationTask = {
  card: FlashcardRow;
  concept: string;
  format: "Rédaction" | "Calcul et vérification" | "Application";
};

function taskFormat(card: FlashcardRow, index: number): SimulationTask["format"] {
  const content = `${card.question} ${card.answer}`.toLocaleLowerCase("fr");
  if (/\d|€|%|calcul|taux|montant|formule/.test(content)) return "Calcul et vérification";
  return index === 0 ? "Rédaction" : "Application";
}

function fmt(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/** A deliberately short, local exam simulation. It uses the student's own
 * imported cards rather than inventing DCG facts, prioritises weak concepts,
 * and turns the result into the same explicit SM-2 schedule as any review. */
export function AdaptiveSimulation({ onClose }: { onClose: () => void }) {
  const [tasks, setTasks] = useState<SimulationTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [remaining, setRemaining] = useState(12 * 60);
  const [finished, setFinished] = useState(false);
  const [results, setResults] = useState<{ solid: number; toReview: number }>({ solid: 0, toReview: 0 });

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const concepts = await api.listConceptProgress();
        const selected = concepts.slice(0, 3);
        const cardsByChapter = new Map<number, FlashcardRow[]>();
        await Promise.all([...new Set(selected.map((concept) => concept.chapter_id))].map(async (chapterId) => {
          cardsByChapter.set(chapterId, await api.listFlashcards(chapterId));
        }));
        const next = selected.flatMap((concept, taskIndex) => {
          const card = cardsByChapter.get(concept.chapter_id)?.find((item) => item.concept_id === concept.concept_id)
            ?? cardsByChapter.get(concept.chapter_id)?.[0];
          if (!card) return [];
          return [{
            card,
            concept: concept.concept_label ?? concept.concept_id ?? concept.chapter_name,
            format: taskFormat(card, taskIndex),
          }];
        });
        if (!next.length) throw new Error("Étudie d'abord une leçon : la simulation utilisera ensuite tes notions réellement fragiles.");
        if (live) setTasks(next);
      } catch (reason) {
        if (live) setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (live) setLoading(false);
      }
    };
    void load();
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (loading || finished) return;
    const timer = window.setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          setFinished(true);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [finished, loading]);

  const task = tasks[index] ?? null;
  const record = async (quality: 5 | 1) => {
    if (!task) return;
    await api.updateFlashcardProgress(task.card.id, quality);
    setResults((current) => quality === 5
      ? { ...current, solid: current.solid + 1 }
      : { ...current, toReview: current.toReview + 1 });
    if (index >= tasks.length - 1) {
      setFinished(true);
      return;
    }
    setIndex((value) => value + 1);
    setAnswer("");
    setRevealed(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 700, overflowY: "auto", background: "rgba(7, 11, 20, .78)", padding: "24px 16px" }}>
      <div className="surface" style={{ maxWidth: 720, margin: "0 auto", padding: 22, background: "var(--card)" }}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 16 }}>
          <div><div className="section-kicker">Simulation DCG adaptative</div><h2 style={{ margin: "3px 0 0" }}>12 minutes · notions à risque</h2></div>
          <button className="soft-button" onClick={onClose}>Quitter</button>
        </header>

        {loading && <p style={{ color: "var(--muted)" }}>Préparation des notions les plus fragiles…</p>}
        {error && <div style={{ color: "var(--t-err)", lineHeight: 1.55 }}>{error}</div>}
        {finished && !loading && !error && <div style={{ textAlign: "center", padding: "22px 0" }}><div style={{ fontSize: 32 }}>✓</div><h3>Simulation terminée</h3><p style={{ color: "var(--muted)", lineHeight: 1.55 }}>{results.solid} réponse{results.solid > 1 ? "s" : ""} solide{results.solid > 1 ? "s" : ""} · {results.toReview} à reprendre. Les cartes ont été reprogrammées par SM‑2.</p><button className="primary-button" onClick={onClose}>Retour au plan</button></div>}

        {task && !finished && <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, color: "var(--muted)", fontSize: 12 }}><span>{index + 1}/{tasks.length} · {task.format} · {task.concept}</span><strong style={{ color: remaining < 120 ? "var(--t-err)" : "var(--t-pri)", fontFamily: "var(--font-mono)", fontSize: 18 }}>{fmt(remaining)}</strong></div>
          <div style={{ height: 4, background: "var(--track)", overflow: "hidden", borderRadius: 4, marginBottom: 18 }}><i style={{ display: "block", height: "100%", width: `${((index + (revealed ? 1 : 0)) / tasks.length) * 100}%`, background: "var(--t-pri)" }} /></div>
          <div style={{ borderLeft: "3px solid var(--t-pri)", background: "var(--card2)", padding: 15 }}><strong style={{ fontSize: 14 }}>{task.card.question}</strong><p style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.55, margin: "9px 0 0" }}>Rédige la règle puis son application. Pour un calcul, pose les données, la formule et un contrôle de cohérence.</p></div>
          {!revealed ? <><textarea autoFocus value={answer} onChange={(event) => setAnswer(event.target.value)} rows={6} placeholder="Ta réponse rédigée, sans regarder le verso…" style={{ width: "100%", boxSizing: "border-box", marginTop: 14, background: "var(--input)", border: "1px solid var(--input-border)", borderRadius: 3, color: "var(--text)", padding: 11, lineHeight: 1.5, fontSize: 13 }} /><button className="primary-button" disabled={!answer.trim()} onClick={() => setRevealed(true)} style={{ width: "100%", marginTop: 10 }}>Comparer au corrigé →</button></> : <div style={{ marginTop: 14, background: "var(--t-okb)", borderLeft: "3px solid var(--t-ok)", padding: 14 }}><strong>Règle / corrigé de référence</strong><p style={{ margin: "7px 0 0", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{task.card.answer}</p><p style={{ fontSize: 12, color: "var(--muted)", margin: "10px 0 0" }}>Évalue le raisonnement, pas seulement le résultat final.</p><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginTop: 10 }}><button className="soft-button" onClick={() => void record(1)}>À reprendre · SM‑2 court</button><button className="primary-button" onClick={() => void record(5)}>Solide · espacer</button></div></div>}
        </>}
      </div>
    </div>
  );
}
