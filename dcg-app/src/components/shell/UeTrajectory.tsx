import { DEFAULT_EXAM_DATE, getExamPhase } from "../../lib/examPlan";
import { buildUeTrajectories, type UeTrajectoryStatus } from "../../lib/ueTrajectory";
import type { AnnaleAttempt, Chapter, QcmScoreRow, Ue } from "../../lib/types";

const STATUS_COPY: Record<UeTrajectoryStatus, { label: string; color: string }> = {
  priority: { label: "Priorité", color: "var(--t-err)" },
  start: { label: "À lancer", color: "var(--t-acc)" },
  on_track: { label: "Dans le rythme", color: "var(--t-ok)" },
  complete: { label: "Couvert", color: "var(--t-pri)" },
};

export function UeTrajectory({
  ues,
  chapters,
  qcmScores,
  examDate,
  annales,
}: {
  ues: Ue[];
  chapters: Chapter[];
  qcmScores: QcmScoreRow[];
  examDate?: string | null;
  annales: AnnaleAttempt[];
}) {
  const targetDate = examDate || DEFAULT_EXAM_DATE;
  const phase = getExamPhase(targetDate);
  const trajectories = buildUeTrajectories(ues, chapters, qcmScores, targetDate, new Date(), annales);

  if (!trajectories.length) return null;

  return (
    <section className="surface" style={{ marginBottom: 24, padding: 18 }}>
      <div className="panel-header" style={{ marginBottom: 14 }}>
        <div>
          <div className="section-kicker">Trajectoire vers l'examen</div>
          <h2 style={{ margin: 0 }}>Chaque UE a une prochaine action</h2>
        </div>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>{phase.daysLeft} jours avant l'examen</span>
      </div>
      <p style={{ margin: "0 0 14px", color: "var(--muted)", fontSize: 13, lineHeight: 1.55 }}>
        {phase.guidance} Pendant la couverture, la cible temporelle est de {trajectories[0].expectedCoveragePercent}% par UE : elle sert à répartir l'effort, pas à juger la maîtrise.
      </p>
      <div style={{ display: "grid", gap: 9 }}>
        {trajectories.map((trajectory) => {
          const status = STATUS_COPY[trajectory.status];
          return (
            <div key={trajectory.ue.id} style={{ display: "grid", gridTemplateColumns: "minmax(150px, 1fr) minmax(170px, 1.25fr) minmax(190px, 1.7fr)", gap: 14, alignItems: "center", borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <div>
                <strong style={{ fontSize: 13 }}>{trajectory.ue.code} · {trajectory.ue.name}</strong>
                <div style={{ marginTop: 4, color: status.color, fontSize: 11, fontWeight: 700 }}>{status.label}</div>
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", color: "var(--muted)", fontSize: 11, marginBottom: 4 }}>
                  <span>{trajectory.completedChapters}/{trajectory.totalChapters} chapitres</span>
                  <span>{trajectory.qcmPercent === null ? "QCM à mesurer" : `${trajectory.qcmPercent}% QCM`}</span>
                </div>
                <div style={{ height: 5, overflow: "hidden", background: "var(--track)", borderRadius: 4 }}>
                  <i style={{ display: "block", width: `${trajectory.completionPercent}%`, height: "100%", background: trajectory.ue.color ?? "var(--accent-blue)" }} />
                </div>
              </div>
              <div>
                <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45 }}>{trajectory.recommendation}</p>
                {trajectory.annaleRecommendation && <div style={{ marginTop: 7, paddingTop: 7, borderTop: "1px solid var(--border)", color: "var(--muted)", fontSize: 10, lineHeight: 1.45 }}><strong style={{ color: "var(--accent-blue)" }}>Annale conseillée · {trajectory.annaleRecommendation.durationMinutes} min</strong><br />{trajectory.annaleRecommendation.copy}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
