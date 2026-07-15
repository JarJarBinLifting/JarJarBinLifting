import { useEffect, useState } from "react";
import { useAppState } from "../../state/AppState";
import { useTheme } from "../../lib/theme";
import * as api from "../../lib/api";
import { avgScorePct, chapterProgress, computeStudyStreak, countdownTo, daysSinceLastActivity, todayIso } from "../../lib/format";
import type { Chapter, Ue, WeakChapter } from "../../lib/types";
import type { ShellView } from "./Nav";

const GAP_THRESHOLD_DAYS = 3;
type QuickStartReason = "gentle" | "weak" | "due" | "next";

const REASON_LABEL: Record<QuickStartReason, string> = {
  gentle: "Reprise en douceur",
  weak: "Point à consolider",
  due: "Révision attendue",
  next: "Prochain chapitre",
};

function pickQuickStart(chapters: Chapter[], weak: WeakChapter[], dueChapterIds: number[], gapDays: number | null) {
  const byId = (id: number) => chapters.find((chapter) => chapter.id === id);
  if (gapDays !== null && gapDays >= GAP_THRESHOLD_DAYS) {
    const chapter = weak.find((entry) => entry.box_level !== null && byId(entry.chapter_id));
    if (chapter) return { chapter: byId(chapter.chapter_id)!, reason: "gentle" as const };
  }
  if (weak[0] && byId(weak[0].chapter_id)) return { chapter: byId(weak[0].chapter_id)!, reason: "weak" as const };
  if (dueChapterIds[0] && byId(dueChapterIds[0])) return { chapter: byId(dueChapterIds[0])!, reason: "due" as const };
  const next = chapters.find((chapter) => chapter.status === "ongoing") ?? chapters.find((chapter) => chapter.status === "todo");
  return next ? { chapter: next, reason: "next" as const } : null;
}

export function Dashboard({ onOpenUe, onNavigate, onQuickStart }: { onOpenUe: (ue: Ue) => void; onNavigate: (view: ShellView) => void; onQuickStart: (chapter: Chapter) => void }) {
  const { ues, chapters, qcmScores, timerSessions, dueChapters, errorNotes, examDate } = useAppState();
  const { theme, toggle } = useTheme();
  const [weak, setWeak] = useState<WeakChapter[]>([]);
  const [, tick] = useState(0);

  useEffect(() => { api.listWeakChapters().then(setWeak); }, [dueChapters, qcmScores]);
  useEffect(() => { const id = window.setInterval(() => tick((value) => value + 1), 60_000); return () => window.clearInterval(id); }, []);

  // Local calendar day, matching todayIso() in Pilotage and the backend's
  // date('now','localtime') — toISOString() is UTC and disagrees with all of
  // them for the first hour(s) after local midnight.
  const today = todayIso();
  const dueToday = dueChapters.filter((item) => item.next_review_date <= today);
  const dueErrors = errorNotes.filter((item) => item.status === "active" && item.next_review_date <= today);
  const activityDates = [...timerSessions.map((item) => item.ended_at), ...qcmScores.map((item) => item.date)];
  const gapDays = daysSinceLastActivity(activityDates);
  const quickStart = pickQuickStart(chapters, weak, dueChapters.map((item) => item.chapter_id), gapDays);
  const quickStartUe = quickStart ? ues.find((ue) => ue.id === quickStart.chapter.ue_id) : null;
  const countdown = examDate ? countdownTo(examDate) : null;
  const totalDone = chapters.filter((chapter) => chapter.status === "done").length;
  const averageScore = avgScorePct(qcmScores);
  const streak = computeStudyStreak(activityDates);

  return (
    <div className="desktop-page">
      <header className="work-header">
        <div>
          <div className="eyebrow">Table de travail</div>
          <h1 className="work-title">Bonjour, Amadou.</h1>
          <p className="work-lead">Un espace calme pour voir l’essentiel, travailler une chose à la fois et progresser vers l’examen.</p>
        </div>
        <button className="soft-button" onClick={toggle}>{theme === "dark" ? "Mode clair" : "Mode sombre"}</button>
      </header>

      <section className="focus-board surface">
        <div className="focus-main">
          <div className="section-kicker">Ta prochaine meilleure action</div>
          {quickStart && quickStartUe ? (
            <>
              <div className="focus-reason">{REASON_LABEL[quickStart.reason]}</div>
              <h2>{quickStart.chapter.name}</h2>
              <p>{quickStartUe.code} · {quickStartUe.name}{quickStart.reason === "gentle" && gapDays ? ` · reprise après ${gapDays} jours` : ""}</p>
              <button className="primary-button" onClick={() => onQuickStart(quickStart.chapter)}>Ouvrir la session de travail <span>→</span></button>
            </>
          ) : (
            <>
              <h2>Ton espace est prêt.</h2>
              <p>Choisis une UE et ajoute ton premier chapitre pour commencer.</p>
            </>
          )}
        </div>
        <div className="focus-divider" />
        <div className="focus-exam">
          <div className="section-kicker">Session d’examen</div>
          {countdown && !countdown.passed ? <><div className="exam-days">{countdown.days}</div><div className="exam-copy">jours avant ton échéance</div><div className="exam-sub">{countdown.hours} h · {countdown.minutes} min</div></> : <><div className="exam-empty">—</div><div className="exam-copy">Date non définie</div><button className="text-action" onClick={() => onNavigate("settings")}>Ajouter une échéance →</button></>}
        </div>
      </section>

      <section className="dashboard-metrics">
        <Metric value={`${totalDone}/${chapters.length || 0}`} label="chapitres maîtrisés" tone="green" />
        <Metric value={averageScore === null ? "—" : `${averageScore}%`} label="score QCM moyen" tone={averageScore !== null && averageScore < 60 ? "amber" : "green"} />
        <Metric value={streak ? `${streak} j` : "—"} label="rythme actuel" tone="blue" />
        <Metric value={dueErrors.length + dueToday.length} label="actions utiles aujourd’hui" tone={dueErrors.length ? "red" : "blue"} />
      </section>

      <div className="dashboard-grid">
        <section className="surface work-queue">
          <div className="panel-header"><div><div className="section-kicker">Aujourd’hui</div><h2>Ton dossier de révision</h2></div><button className="text-action" onClick={() => onNavigate("agenda")}>Tout voir →</button></div>
          {dueErrors.length > 0 && <button className="queue-priority" onClick={() => onNavigate("pilotage")}><span className="queue-dot red" /><div><strong>{dueErrors.length} erreur{dueErrors.length > 1 ? "s" : ""} à transformer en réflexe</strong><small>Rappel actif, mini-cas, puis travail chronométré.</small></div><span>→</span></button>}
          {dueToday.slice(0, dueErrors.length ? 2 : 3).map((item) => <button className="queue-row" key={item.chapter_id} onClick={() => { const chapter = chapters.find((entry) => entry.id === item.chapter_id); if (chapter) onQuickStart(chapter); }}><span className="queue-dot" /><div><small>{item.ue_code} · boîte {item.box_level}</small><strong>{item.chapter_name}</strong></div><span>Réviser →</span></button>)}
          {!dueErrors.length && !dueToday.length && <div className="queue-empty"><strong>Aucun retard à combler.</strong><p>Continue avec le prochain chapitre ou une session libre.</p><button className="soft-button" onClick={() => onNavigate("timer")}>Lancer une session</button></div>}
        </section>

        <section className="surface weak-panel">
          <div className="panel-header"><div><div className="section-kicker">À surveiller</div><h2>Signaux faibles</h2></div><button className="text-action" onClick={() => onNavigate("pilotage")}>Pilotage →</button></div>
          {weak.slice(0, 4).map((entry) => {
            const score = entry.latest_qcm_total ? Math.round(((entry.latest_qcm_score ?? 0) / entry.latest_qcm_total) * 100) : null;
            return <div className="weak-row" key={entry.chapter_id}><span style={{ background: entry.ue_color ?? "var(--border)" }} /><div><small>{entry.ue_code}</small><strong>{entry.chapter_name}</strong></div><b>{score === null ? `B${entry.box_level ?? 1}` : `${score}%`}</b></div>;
          })}
          {!weak.length && <div className="queue-empty"><strong>Les signaux apparaîtront ici.</strong><p>Ils se construisent au fil de tes QCM et révisions.</p></div>}
        </section>
      </div>

      <section className="subject-section">
        <div className="panel-header subject-header"><div><div className="section-kicker">Programme</div><h2>Unités d’enseignement</h2></div><span>{ues.length} UE suivies</span></div>
        <div className="subject-table surface">
          {ues.map((ue) => {
            const ueChapters = chapters.filter((chapter) => chapter.ue_id === ue.id);
            const progress = chapterProgress(ueChapters);
            const scores = qcmScores.filter((score) => ueChapters.some((chapter) => chapter.id === score.chapter_id));
            const average = avgScorePct(scores);
            return <button key={ue.id} className="subject-row" onClick={() => onOpenUe(ue)}><span className="subject-mark" style={{ background: ue.color ?? "var(--accent-blue)" }} /><div className="subject-name"><small>{ue.code}</small><strong>{ue.name}</strong></div><div className="subject-progress"><div><span>{progress}% couvert</span><span>{average === null ? "Pas de QCM" : `${average}% QCM`}</span></div><i><b style={{ width: `${progress}%`, background: ue.color ?? "var(--accent-blue)" }} /></i></div><span className="subject-open">Ouvrir →</span></button>;
          })}
        </div>
      </section>
    </div>
  );
}

function Metric({ value, label, tone }: { value: string | number; label: string; tone: "green" | "amber" | "blue" | "red" }) {
  return <div className={`metric ${tone}`}><strong>{value}</strong><span>{label}</span></div>;
}
