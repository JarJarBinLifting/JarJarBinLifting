import { useEffect, useState } from "react";
import * as api from "../../lib/api";
import type { FlashcardRow } from "../../lib/types";
import { exercisesForConcept, planExamSimulation, rubricTotal, type ExamSimulationTask } from "./examExercises";

type SessionLength = 12 | 25 | 45;
type Result = { earned: number; total: number; strong: number; review: number; scheduled: number };

const LENGTHS: { value: SessionLength; label: string; detail: string }[] = [
  { value: 12, label: "12 min", detail: "un dossier ciblé" },
  { value: 25, label: "25 min", detail: "deux à trois compétences" },
  { value: 45, label: "45 min", detail: "entraînement soutenu" },
];
const FORMAT = { redaction: "Rédaction", calcul: "Calcul et vérification", application: "Application" } as const;
const fmt = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

/** Uses only reviewed exercise data from an imported lesson. Every answer is
 * written before exposure, graded criterion by criterion, then scheduled by
 * the existing SM-2 card loop. */
export function ExamSimulation({ onClose }: { onClose: () => void }) {
  const [duration, setDuration] = useState<SessionLength>(12);
  const [started, setStarted] = useState(false);
  const [tasks, setTasks] = useState<ExamSimulationTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [criteria, setCriteria] = useState<Record<number, boolean>>({});
  const [remaining, setRemaining] = useState(duration * 60);
  const [finished, setFinished] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [result, setResult] = useState<Result>({ earned: 0, total: 0, strong: 0, review: 0, scheduled: 0 });

  useEffect(() => {
    if (!started) return;
    let live = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const concepts = (await api.listConceptProgress()).slice(0, 8);
        if (!concepts.length) throw new Error("Étudie d'abord une leçon avec des flashcards : la simulation ciblera ensuite tes notions réellement fragiles.");
        const ids = [...new Set(concepts.map((concept) => concept.chapter_id))];
        const versions = new Map<number, Awaited<ReturnType<typeof api.listLessonVersions>>>();
        const cards = new Map<number, FlashcardRow[]>();
        await Promise.all(ids.map(async (chapterId) => {
          const [chapterVersions, chapterCards] = await Promise.all([api.listLessonVersions(chapterId), api.listFlashcards(chapterId)]);
          versions.set(chapterId, chapterVersions);
          cards.set(chapterId, chapterCards);
        }));
        const groups = concepts.map((concept) => exercisesForConcept({
          concept,
          version: versions.get(concept.chapter_id)?.find((version) => version.is_active),
          cards: cards.get(concept.chapter_id) ?? [],
        }));
        const candidates: ExamSimulationTask[] = [];
        for (let rank = 0; rank < Math.max(...groups.map((group) => group.length), 0); rank += 1) {
          groups.forEach((group) => { if (group[rank]) candidates.push(group[rank]); });
        }
        const planned = planExamSimulation(candidates, duration);
        if (!planned.length) throw new Error("Aucun mini-exercice validé n'est disponible. Réimporte une leçon générée avec le prompt v5 : il demande des exercices, un barème et des pièges expliqués.");
        if (live) { setTasks(planned); setRemaining(duration * 60); }
      } catch (reason) {
        if (live) setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (live) setLoading(false);
      }
    };
    void load();
    return () => { live = false; };
  }, [duration, started]);

  useEffect(() => {
    if (!started || loading || finished || error) return;
    const timer = window.setInterval(() => setRemaining((value) => {
      if (value <= 1) { window.clearInterval(timer); setTimedOut(true); setFinished(true); return 0; }
      return value - 1;
    }), 1000);
    return () => window.clearInterval(timer);
  }, [error, finished, loading, started]);

  const task = tasks[index] ?? null;
  const maxPoints = task ? rubricTotal(task.exercise) : 0;
  const earned = task?.exercise.bareme.reduce((sum, criterion, criterionIndex) => sum + (criteria[criterionIndex] ? criterion.points : 0), 0) ?? 0;

  const record = async () => {
    if (!task) return;
    const ratio = maxPoints ? earned / maxPoints : 0;
    const quality = ratio >= 0.85 ? 5 : ratio >= 0.6 ? 3 : 1;
    if (task.card) await api.updateFlashcardProgress(task.card.id, quality);
    setResult((current) => ({ earned: current.earned + earned, total: current.total + maxPoints, strong: current.strong + (ratio >= 0.75 ? 1 : 0), review: current.review + (ratio < 0.75 ? 1 : 0), scheduled: current.scheduled + (task.card ? 1 : 0) }));
    if (index >= tasks.length - 1) { setFinished(true); return; }
    setIndex((value) => value + 1); setAnswer(""); setCriteria({}); setRevealed(false);
  };

  return <div style={{ position: "fixed", inset: 0, zIndex: 700, overflowY: "auto", background: "rgba(7, 11, 20, .78)", padding: "24px 16px" }}>
    <div className="surface" style={{ maxWidth: 800, margin: "0 auto", padding: 24, background: "var(--card)" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 20 }}><div><div className="section-kicker">Simulation DCG adaptative</div><h2 style={{ margin: "3px 0 0", fontFamily: "var(--font-display)" }}>{started ? `${duration} minutes · copie guidée` : "Choisir ton format"}</h2></div><button className="soft-button" onClick={onClose}>Quitter</button></header>
      {!started && <section><p style={{ color: "var(--muted)", lineHeight: 1.6 }}>La séance utilise uniquement les mini-exercices validés dans tes leçons importées. Tu rédiges avant de consulter une grille de correction et chaque faiblesse repart dans SM-2.</p><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, margin: "22px 0" }}>{LENGTHS.map((length) => <button key={length.value} onClick={() => setDuration(length.value)} style={{ padding: 15, textAlign: "left", color: duration === length.value ? "var(--text)" : "var(--muted)", background: duration === length.value ? "color-mix(in srgb,var(--accent-blue) 8%,var(--card))" : "var(--card2)", border: `1px solid ${duration === length.value ? "var(--accent-blue)" : "var(--border)"}`, borderRadius: 5 }}><strong style={{ display: "block", fontSize: 17 }}>{length.label}</strong><span style={{ display: "block", marginTop: 3, fontSize: 11 }}>{length.detail}</span></button>)}</div><div style={{ padding: 14, borderLeft: "3px solid var(--accent-blue)", background: "var(--card2)", color: "var(--muted)", fontSize: 12, lineHeight: 1.55 }}><strong style={{ color: "var(--text)" }}>Méthode de correction</strong><br />Pour chaque critère : compare ta copie à l'attendu, lis le piège, puis coche uniquement ce qui est réellement présent.</div><button className="primary-button" onClick={() => { setStarted(true); setFinished(false); setTimedOut(false); setIndex(0); setResult({ earned: 0, total: 0, strong: 0, review: 0, scheduled: 0 }); }} style={{ width: "100%", marginTop: 18 }}>Préparer la simulation de {duration} min →</button></section>}
      {started && loading && <p style={{ color: "var(--muted)" }}>Sélection des exercices liés à tes notions les plus fragiles…</p>}
      {started && error && <div style={{ color: "var(--accent-red)", lineHeight: 1.6 }}><strong>Simulation indisponible</strong><p style={{ marginTop: 6 }}>{error}</p></div>}
      {started && finished && !loading && !error && <div style={{ textAlign: "center", padding: "22px 0" }}><div style={{ fontSize: 32 }}>✓</div><h3 style={{ fontFamily: "var(--font-display)", fontSize: 24, margin: "5px 0" }}>{timedOut ? "Temps écoulé" : "Simulation terminée"}</h3><p style={{ color: "var(--muted)", lineHeight: 1.6 }}>{result.earned}/{result.total} points · {result.strong} exercice{result.strong > 1 ? "s" : ""} solide{result.strong > 1 ? "s" : ""} · {result.review} à reprendre. {result.scheduled ? `${result.scheduled} carte${result.scheduled > 1 ? "s" : ""} reprogrammée${result.scheduled > 1 ? "s" : ""} avec SM‑2.` : "Aucune carte associée n'a pu être reprogrammée."}</p><button className="primary-button" onClick={onClose} style={{ marginTop: 16 }}>Retour au plan</button></div>}
      {started && task && !loading && !finished && !error && <><div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 14, color: "var(--muted)", fontSize: 12 }}><span>{index + 1}/{tasks.length} · {FORMAT[task.exercise.format]} · {task.ueCode} · {task.concept}</span><strong style={{ color: remaining < 120 ? "var(--accent-red)" : "var(--accent-blue)", fontFamily: "var(--font-mono)", fontSize: 19 }}>{fmt(remaining)}</strong></div><section style={{ borderLeft: "3px solid var(--accent-blue)", background: "var(--card2)", padding: 17 }}><div className="section-kicker">{task.exercise.titre} · objectif {task.exercise.duree_minutes} min</div><p style={{ margin: "8px 0 0", color: "var(--text)", whiteSpace: "pre-wrap", lineHeight: 1.65 }}>{task.exercise.enonce}</p><div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}><strong>Consigne</strong><p style={{ margin: "4px 0 0", color: "var(--muted)", lineHeight: 1.55 }}>{task.exercise.consigne}</p></div></section>{!revealed ? <><textarea autoFocus value={answer} onChange={(event) => setAnswer(event.target.value)} rows={9} placeholder="Rédige ta réponse sans regarder le corrigé…" style={{ width: "100%", boxSizing: "border-box", marginTop: 14, background: "var(--input)", border: "1px solid var(--input-border)", borderRadius: 4, color: "var(--text)", padding: 12, lineHeight: 1.55, fontSize: 13 }} /><button className="primary-button" disabled={!answer.trim()} onClick={() => setRevealed(true)} style={{ width: "100%", marginTop: 10 }}>Passer à la grille de correction →</button></> : <section style={{ marginTop: 14, padding: 16, border: "1px solid var(--border)", background: "var(--card)" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 12 }}><div><div className="section-kicker">Auto-correction guidée</div><strong style={{ display: "block", marginTop: 3 }}>Coche uniquement ce qui est réellement présent dans ta copie.</strong></div><b style={{ color: "var(--accent-blue)", fontFamily: "var(--font-mono)" }}>{earned}/{maxPoints} pts</b></div><div style={{ display: "grid", gap: 9 }}>{task.exercise.bareme.map((criterion, criterionIndex) => <label key={`${criterion.critere}:${criterionIndex}`} style={{ display: "grid", gridTemplateColumns: "18px minmax(0,1fr) auto", gap: 10, alignItems: "flex-start", padding: 11, background: "var(--card2)", border: "1px solid var(--border)", cursor: "pointer" }}><input type="checkbox" checked={Boolean(criteria[criterionIndex])} onChange={(event) => setCriteria((current) => ({ ...current, [criterionIndex]: event.target.checked }))} /><span><strong style={{ fontSize: 12 }}>{criterion.critere}</strong><span style={{ display: "block", marginTop: 3, color: "var(--muted)", fontSize: 11, lineHeight: 1.5 }}><b style={{ color: "var(--text)" }}>Attendu :</b> {criterion.attendu}</span>{criterion.piege && <span style={{ display: "block", marginTop: 4, color: "var(--accent-yellow)", fontSize: 11, lineHeight: 1.5 }}><b>Piège :</b> {criterion.piege}</span>}</span><b style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{criterion.points} pt{criterion.points > 1 ? "s" : ""}</b></label>)}</div><div style={{ marginTop: 14, padding: 13, borderLeft: "3px solid var(--accent-green)", background: "color-mix(in srgb,var(--accent-green) 7%,var(--card))" }}><strong>Corrigé de référence</strong><p style={{ margin: "6px 0 0", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{task.exercise.corrige}</p></div><button className="primary-button" onClick={() => void record()} style={{ width: "100%", marginTop: 14 }}>Valider cette auto-correction et programmer la reprise →</button></section>}</>}
    </div>
  </div>;
}
