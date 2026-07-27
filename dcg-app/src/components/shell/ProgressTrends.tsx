import { useMemo } from "react";
import { useAppState } from "../../state/AppState";

const DAY = 86_400_000;
function localDay(value: string) { const date = new Date(value.includes("T") ? value : `${value}T12:00:00`); return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(); }

export function ProgressTrends() {
  const { chapters, qcmScores, timerSessions, errorNotes, lessons } = useAppState();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weeks = useMemo(() => Array.from({ length: 6 }, (_, index) => {
    const end = today - (5 - index) * 7 * DAY + DAY;
    const start = end - 7 * DAY;
    const scores = qcmScores.filter((score) => { const date = localDay(score.date); return date >= start && date < end; });
    const average = scores.length ? Math.round(scores.reduce((sum, score) => sum + score.score / Math.max(1, score.total) * 100, 0) / scores.length) : null;
    return { label: new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit" }).format(new Date(start)), average };
  }), [qcmScores, today]);
  const last7Start = today - 6 * DAY;
  const recentSessions = timerSessions.filter((session) => localDay(session.ended_at) >= last7Start);
  const recentScores = qcmScores.filter((score) => localDay(score.date) >= last7Start);
  const activeDays = new Set([...recentSessions.map((session) => localDay(session.ended_at)), ...recentScores.map((score) => localDay(score.date))]).size;
  const minutes = Math.round(recentSessions.reduce((sum, session) => sum + session.duration_seconds, 0) / 60);
  const prepared = lessons.filter((lesson) => lesson.warning_count === 0 && lesson.flag_count === 0 && (lesson.prompt_version ?? 0) >= 2).length;
  const masteredErrors = errorNotes.filter((error) => error.status === "mastered").length;
  const activeErrors = errorNotes.filter((error) => error.status === "active").length;
  const latest = weeks.filter((week) => week.average !== null);
  const qcmDelta = latest.length >= 2 ? latest[latest.length - 1].average! - latest[latest.length - 2].average! : null;
  const reviewReady = activeDays >= 5;

  return <>
    <section className="progress-trends surface"><div className="panel-header"><div><div className="section-kicker">Tendance sur 6 semaines</div><h2>Les efforts deviennent-ils des points ?</h2></div>{qcmDelta !== null && <span className={qcmDelta >= 0 ? "positive" : "negative"}>{qcmDelta >= 0 ? "+" : ""}{qcmDelta} pts</span>}</div><div className="qcm-trend-chart">{weeks.map((week) => <div key={week.label}><span>{week.average === null ? "—" : `${week.average}%`}</span><i><b style={{ height: `${week.average ?? 2}%` }} /></i><small>{week.label}</small></div>)}</div><div className="progress-trend-metrics"><div><strong>{chapters.filter((chapter) => chapter.status === "done").length}/{chapters.length}</strong><span>chapitres couverts</span></div><div><strong>{prepared}/{chapters.length}</strong><span>leçons prêtes</span></div><div><strong>{masteredErrors}</strong><span>erreurs maîtrisées</span></div><div><strong>{activeErrors}</strong><span>faiblesses actives</span></div></div></section>
    <section className="usage-review surface"><div><div className="section-kicker">Revue d'usage · 7 jours</div><h2>{reviewReady ? "Assez de données pour faire le point" : "Construis une semaine représentative"}</h2><p>{reviewReady ? "Regarde ce qui t'a réellement fait revenir et ce qui a créé de la friction avant d'ajouter une nouvelle fonction." : `Tu as étudié ${activeDays} jour${activeDays > 1 ? "s" : ""} sur 7. Vise au moins 5 jours actifs pour juger honnêtement le rythme.`}</p></div><div className="usage-review-numbers"><span><b>{activeDays}/7</b> jours actifs</span><span><b>{minutes}</b> minutes</span><span><b>{recentScores.length}</b> QCM terminés</span></div><div className="usage-review-checklist"><strong>À noter pendant le test</strong><p>□ Ai-je compris immédiatement quoi faire aujourd'hui ?</p><p>□ L'import de leçon m'a-t-il ralenti ?</p><p>□ Ai-je corrigé au moins une erreur utile ?</p><p>□ Le volume quotidien était-il réellement finissable ?</p></div></section>
  </>;
}
