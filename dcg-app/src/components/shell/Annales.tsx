import { useEffect, useState } from "react";
import * as api from "../../lib/api";
import type { AnnaleAttempt } from "../../lib/types";
import { getExamPhase, DEFAULT_EXAM_DATE } from "../../lib/examPlan";
import { useAppState } from "../../state/AppState";
import { AnnaleModal } from "./AnnaleModal";
import { AnnaleRecovery } from "./AnnaleRecovery";

export function Annales() {
  const { examDate, refreshAll, errorNotes } = useAppState();
  const [attempts, setAttempts] = useState<AnnaleAttempt[]>([]);
  const [open, setOpen] = useState<{ resume: AnnaleAttempt | null } | null>(null);
  const [recovery, setRecovery] = useState<AnnaleAttempt | null>(null);
  const phase = getExamPhase(examDate || DEFAULT_EXAM_DATE);

  const refresh = () => api.listAnnales().then(setAttempts);
  useEffect(() => { void refresh(); }, []);

  const completed = attempts.filter((attempt) => attempt.status === "completed");
  const scored = completed.filter((attempt) => attempt.score !== null && attempt.total);
  const average = scored.length
    ? Math.round(scored.reduce((sum, attempt) => sum + ((attempt.score ?? 0) / (attempt.total ?? 1)) * 100, 0) / scored.length)
    : null;

  if (recovery) {
    return <AnnaleRecovery
      attempt={recovery}
      attempts={attempts}
      errors={errorNotes}
      onBack={() => setRecovery(null)}
      onAdvance={async (error) => { await api.advanceErrorNote(error.id); await refreshAll(); }}
      onCreatePlan={async (plan) => {
        await api.createErrorNote({
          ue_id: recovery.ue_id,
          chapter_id: recovery.chapter_id,
          title: plan.title,
          error_type: plan.error_type,
          skill: plan.skill,
          my_reasoning: plan.my_reasoning,
          correction: plan.correction,
          source: "annale",
        });
        await refreshAll();
      }}
    />;
  }

  return (
    <div className="desktop-page annales-page">
      <header className="work-header">
        <div>
          <div className="eyebrow">Conditions d'examen</div>
          <h1 className="work-title">Annales</h1>
          <p className="work-lead">Travaille un vrai sujet au chronomètre, reprends ta copie et transforme les points perdus en révisions.</p>
        </div>
        <button className="primary-button" onClick={() => setOpen({ resume: null })}>Nouvelle annale</button>
      </header>

      <section className="annales-summary">
        <div className="surface"><small>PHASE ACTUELLE</small><strong>{phase.shortLabel}</strong><p>{phase.id === "coverage" ? "Tu peux commencer par des extraits ciblés." : phase.guidance}</p></div>
        <div className="surface"><small>SUJETS TERMINÉS</small><strong>{completed.length}</strong><p>{attempts.filter((attempt) => attempt.status === "in_progress").length} en cours</p></div>
        <div className="surface"><small>SCORE MOYEN</small><strong>{average === null ? "—" : `${average}%`}</strong><p>sur les copies corrigées</p></div>
      </section>

      <section className="surface annales-list">
        <div className="panel-header"><div><div className="section-kicker">Historique</div><h2>Tes entraînements</h2></div></div>
        {attempts.length === 0 ? (
          <div className="queue-empty"><strong>Aucune annale pour l'instant.</strong><p>Commence par un extrait de 30 à 45 minutes si tu es encore en phase de couverture.</p><button className="soft-button" onClick={() => setOpen({ resume: null })}>Préparer un premier sujet</button></div>
        ) : attempts.map((attempt) => (
          <div key={attempt.id}>
            <button className="annale-row" onClick={() => setOpen({ resume: attempt })}>
              <span className="subject-mark" style={{ background: attempt.ue_color ?? "var(--accent-blue)" }} />
              <div><small>{attempt.ue_code} · {attempt.duration_minutes} min</small><strong>{attempt.title}</strong></div>
              <span className={`annale-status ${attempt.status}`}>{attempt.status === "in_progress" ? "À reprendre" : attempt.status === "completed" ? "Corrigée" : "Abandonnée"}</span>
              <b>{attempt.score !== null ? `${attempt.score}/${attempt.total}` : "Ouvrir →"}</b>
            </button>
            {attempt.status === "completed" && attempt.correction_json && (
              <button className="text-action" style={{ margin: "0 0 10px 25px" }} onClick={() => setRecovery(attempt)}>Voir le plan de reprise →</button>
            )}
          </div>
        ))}
      </section>

      {open && <AnnaleModal resume={open.resume} onClose={() => { setOpen(null); refresh(); refreshAll(); }} />}
    </div>
  );
}
