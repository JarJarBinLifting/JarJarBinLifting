import { useEffect, useState } from "react";
import * as api from "../../lib/api";
import { useAppState } from "../../state/AppState";
import { avgScorePct, chapterProgress } from "../../lib/format";
import { DEFAULT_EXAM_DATE, getExamPhase, weeklyCoverageTarget } from "../../lib/examPlan";
import type { AnnaleAttempt, Ue } from "../../lib/types";
import { UeTrajectory } from "./UeTrajectory";

export function Programme({ onOpenUe }: { onOpenUe: (ue: Ue) => void }) {
  const { ues, chapters, qcmScores, lessons, examDate } = useAppState();
  const phase = getExamPhase(examDate || DEFAULT_EXAM_DATE);
  const [annales, setAnnales] = useState<AnnaleAttempt[]>([]);
  useEffect(() => { void api.listAnnales().then(setAnnales).catch(() => {}); }, []);
  const completed = chapters.filter((chapter) => chapter.status === "done").length;
  const remaining = chapters.length - completed;
  const weeklyTarget = weeklyCoverageTarget(remaining, examDate || DEFAULT_EXAM_DATE);
  const overall = chapters.length ? Math.round((completed / chapters.length) * 100) : 0;

  return (
    <div className="desktop-page programme-page">
      <header className="work-header">
        <div>
          <div className="eyebrow">Programme de révision</div>
          <h1 className="work-title">Réviser</h1>
          <p className="work-lead">Choisis une UE, puis avance chapitre par chapitre. Les rappels déjà planifiés restent dans le plan du jour.</p>
        </div>
      </header>

      <section className="programme-overview surface">
        <div>
          <div className="section-kicker">Couverture globale</div>
          <strong>{overall}%</strong>
          <p>{completed} chapitre{completed !== 1 ? "s" : ""} terminé{completed !== 1 ? "s" : ""} sur {chapters.length}</p>
        </div>
        <div className="programme-overview-track"><i style={{ width: `${overall}%` }} /></div>
        <div>
          <div className="section-kicker">Rythme conseillé</div>
          <strong>{remaining ? weeklyTarget : 0}</strong>
          <p>{remaining ? `nouveau${weeklyTarget > 1 ? "x" : ""} chapitre${weeklyTarget > 1 ? "s" : ""} par semaine` : "programme entièrement couvert"}</p>
        </div>
      </section>

      <div className="phase-inline">
        <span>{phase.shortLabel}</span>
        <p><strong>{phase.objective}.</strong> {phase.guidance}</p>
      </div>

      <UeTrajectory ues={ues} chapters={chapters} qcmScores={qcmScores} examDate={examDate} annales={annales} />

      <section className="subject-section">
        <div className="panel-header subject-header">
          <div><div className="section-kicker">Unités d'enseignement</div><h2>Choisis une UE</h2></div>
          <span>{ues.length} UE suivies</span>
        </div>
        <div className="subject-table surface">
          {ues.map((ue) => {
            const ueChapters = chapters.filter((chapter) => chapter.ue_id === ue.id);
            const progress = chapterProgress(ueChapters);
            const scores = qcmScores.filter((score) => ueChapters.some((chapter) => chapter.id === score.chapter_id));
            const average = avgScorePct(scores);
            const nextChapter = ueChapters.find((chapter) => chapter.status !== "done");
            const readyLessons = ueChapters.filter((chapter) => lessons.some((lesson) => lesson.chapter_id === chapter.id && lesson.warning_count === 0 && lesson.flag_count === 0 && (lesson.prompt_version ?? 0) >= 2)).length;
            const attentionLessons = ueChapters.filter((chapter) => lessons.some((lesson) => lesson.chapter_id === chapter.id && (lesson.warning_count > 0 || lesson.flag_count > 0 || (lesson.prompt_version ?? 0) < 2))).length;
            return (
              <button key={ue.id} className="subject-row" onClick={() => onOpenUe(ue)}>
                <span className="subject-mark" style={{ background: ue.color ?? "var(--accent-blue)" }} />
                <div className="subject-name"><small>{ue.code}</small><strong>{ue.name}</strong>{nextChapter && <em>Prochain : {nextChapter.name}</em>}<em className={attentionLessons ? "lesson-attention" : ""}>{readyLessons}/{ueChapters.length} leçons prêtes{attentionLessons ? ` · ${attentionLessons} à vérifier` : ""}</em></div>
                <div className="subject-progress"><div><span>{progress}% couvert</span><span>{average === null ? "Pas encore de QCM" : `${average}% aux QCM`}</span></div><i><b style={{ width: `${progress}%`, background: ue.color ?? "var(--accent-blue)" }} /></i></div>
                <span className="subject-open">Ouvrir →</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
