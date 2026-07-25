import { useEffect, useState } from "react";
import * as api from "../../lib/api";
import type { CalibrationHistory as CalibrationHistoryData } from "../../lib/types";

const statusCopy = {
  aligned: { label: "Estimation réaliste", color: "var(--accent-green)" },
  overconfident: { label: "Confiance trop haute", color: "var(--accent-red)" },
  cautious: { label: "Confiance prudente", color: "var(--accent-yellow)" },
} as const;

const trendCopy = {
  improving: "L’écart se réduit",
  stable: "Écart stable",
  worsening: "Écart à surveiller",
  insufficient: "Encore une session pour comparer",
} as const;

/** Shows calibration as evidence, not as a score to optimise. A smaller gap
 * means self-assessment is becoming a more useful guide for study choices. */
export function CalibrationHistory() {
  const [history, setHistory] = useState<CalibrationHistoryData | null>(null);

  useEffect(() => {
    let current = true;
    api.getCalibrationHistory().then((data) => {
      if (current) setHistory(data);
    }).catch(() => {
      // Progress remains usable if a pre-upgrade local server has no route yet.
    });
    return () => { current = false; };
  }, []);

  if (!history || history.ues.length === 0) return null;

  return (
    <section className="pilotage-panel surface" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 3, padding: 18, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 13, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 700, color: "var(--text)" }}>Calibration de confiance</div>
          <p style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.5, marginTop: 4 }}>Compare ce que tu pensais savoir avant le QCM et ce que ton rappel démontre. L’objectif est un écart plus juste, pas une confiance plus haute.</p>
        </div>
        <span style={{ color: "var(--muted)", fontSize: 10, maxWidth: 215, lineHeight: 1.45 }}>Seules les sessions terminées avec une auto‑évaluation et un QCM sont affichées.</span>
      </div>
      <div style={{ display: "grid", gap: 9 }}>
        {history.ues.map((ue) => {
          const latest = ue.sessions[ue.sessions.length - 1];
          const status = statusCopy[latest.status];
          return <article key={ue.ue_id} style={{ background: "var(--card2)", border: "1px solid var(--border)", borderLeft: `3px solid ${ue.ue_color ?? "var(--accent-blue)"}`, borderRadius: 3, padding: "11px 12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <div><span style={{ color: ue.ue_color ?? "var(--muted)", fontSize: 10, fontWeight: 800 }}>{ue.ue_code}</span><strong style={{ display: "block", marginTop: 2, color: "var(--text)", fontSize: 13 }}>{ue.ue_name}</strong></div>
              <div style={{ textAlign: "right" }}><strong style={{ display: "block", color: status.color, font: "700 12px var(--font-mono)" }}>{ue.average_absolute_gap} pts d’écart moyen</strong><span style={{ color: "var(--muted)", fontSize: 10 }}>{trendCopy[ue.trend]}</span></div>
            </div>
            <div style={{ display: "flex", gap: 7, overflowX: "auto", marginTop: 10, paddingBottom: 1 }}>
              {ue.sessions.slice(-5).map((point, index) => {
                const copy = statusCopy[point.status];
                return <div key={`${point.completed_at}:${index}`} style={{ minWidth: 136, padding: "8px 9px", borderRadius: 3, background: "var(--input)", borderTop: `2px solid ${copy.color}` }}>
                  <div style={{ color: "var(--muted)", fontSize: 9, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{point.chapter_name}</div>
                  <div style={{ marginTop: 4, color: "var(--text)", font: "600 12px var(--font-mono)" }}>{point.self_rated_percent}% estimé <span style={{ color: "var(--muted)" }}>→</span> {point.assessed_percent}% rappel</div>
                  <div style={{ marginTop: 3, color: copy.color, fontSize: 9, fontWeight: 800 }}>{copy.label} · {point.gap > 0 ? "+" : ""}{point.gap} pts</div>
                </div>;
              })}
            </div>
          </article>;
        })}
      </div>
    </section>
  );
}
