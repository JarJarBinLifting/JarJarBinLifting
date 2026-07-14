import { useEffect, useState } from "react";
import { useAppState } from "../../state/AppState";
import { useTheme } from "../../lib/theme";
import { avgScorePct, chapterProgress, countdownTo } from "../../lib/format";
import type { Ue } from "../../lib/types";
import { StatTile } from "./common";
import type { ShellView } from "./Nav";

export function Dashboard({
  onOpenUe,
  onNavigate,
}: {
  onOpenUe: (ue: Ue) => void;
  onNavigate: (v: ShellView) => void;
}) {
  const { ues, chapters, qcmScores, timerSessions, dueChapters, examDate } = useAppState();
  const { theme, toggle } = useTheme();
  const [, forceTick] = useState(0);

  // re-render every minute so the countdown stays live without a full data refetch
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const totalDone = chapters.filter((c) => c.status === "done").length;
  const gAvg = avgScorePct(qcmScores);
  const cd = examDate ? countdownTo(examDate) : null;
  const dueToday = dueChapters.filter((d) => d.next_review_date <= new Date().toISOString().slice(0, 10));

  return (
    <div style={{ padding: "18px 14px", maxWidth: 920, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
        <div>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: -0.5,
              lineHeight: 1.1,
              color: "var(--text)",
            }}
          >
            DCG <span style={{ color: "var(--accent-blue)" }}>Étude</span>
          </h1>
          <p style={{ fontSize: 11, color: "var(--muted)", margin: "4px 0 0", letterSpacing: 1.2, fontWeight: 700 }}>
            TABLEAU DE BORD
          </p>
        </div>
        <button
          onClick={toggle}
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 2,
            padding: "9px 12px",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 1,
            color: "var(--muted)",
          }}
        >
          {theme === "dark" ? "CLAIR" : "SOMBRE"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 16 }}>
        <StatTile label="Chapitres complétés" value={`${totalDone}/${chapters.length}`} color="var(--accent-green)" />
        <StatTile label="Sessions de travail" value={timerSessions.length} color="var(--accent-blue)" />
        <StatTile
          label="Score QCM moyen"
          value={gAvg !== null ? `${gAvg}%` : "—"}
          color={gAvg ? (gAvg >= 60 ? "var(--accent-green)" : gAvg >= 40 ? "var(--accent-yellow)" : "var(--accent-red)") : "var(--muted)"}
        />
      </div>

      {examDate && cd && (
        <div
          style={{
            marginBottom: 18,
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderLeft: "3px solid var(--accent-blue)",
            borderRadius: 3,
            padding: "18px 20px",
          }}
        >
          <div style={{ fontSize: 10, color: "var(--accent-blue)", fontWeight: 800, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 14 }}>
            Compte à rebours — session DCG
          </div>
          {cd.passed ? (
            <p style={{ fontSize: 14, color: "var(--text)" }}>La date est passée — mets-la à jour dans Réglages.</p>
          ) : (
            <div style={{ display: "flex", gap: 24, alignItems: "baseline", flexWrap: "wrap", marginBottom: 12 }}>
              {[{ l: "Jours", v: cd.days }, { l: "Heures", v: cd.hours }, { l: "Minutes", v: cd.minutes }].map(({ l, v }) => (
                <div key={l}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 40, fontWeight: 700, color: "var(--text)", lineHeight: 1 }}>
                    {v}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 700, marginLeft: 5, letterSpacing: 0.5 }}>{l}</span>
                </div>
              ))}
            </div>
          )}
          <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
            Chaque heure de révision est un investissement sur votre réussite.{" "}
            <strong style={{ color: "var(--text)" }}>Vous y arriverez.</strong>
          </p>
        </div>
      )}
      {!examDate && (
        <button
          onClick={() => onNavigate("settings")}
          style={{
            width: "100%",
            marginBottom: 18,
            textAlign: "left",
            background: "var(--card)",
            border: "1px dashed var(--border)",
            borderRadius: 3,
            padding: "14px 18px",
            color: "var(--muted)",
            fontSize: 13,
          }}
        >
          Ajoute ta date d'examen dans Réglages pour voir le compte à rebours.
        </button>
      )}

      {dueChapters.length > 0 && (
        <button
          onClick={() => onNavigate("agenda")}
          style={{
            width: "100%",
            marginBottom: 18,
            textAlign: "left",
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderLeft: "3px solid var(--accent-yellow)",
            borderRadius: 3,
            padding: "14px 18px",
            color: "var(--text)",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
            {dueToday.length > 0 ? `${dueToday.length} chapitre${dueToday.length > 1 ? "s" : ""} à réviser aujourd'hui` : `${dueChapters.length} chapitre${dueChapters.length > 1 ? "s" : ""} à réviser cette semaine`}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Voir l'agenda de révision →</div>
        </button>
      )}

      <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 800, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 12 }}>
        Unités d'enseignement — {ues.length} UE au programme
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 12, marginBottom: 18 }}>
        {ues.map((ue) => {
          const ueChapters = chapters.filter((c) => c.ue_id === ue.id);
          const pct = chapterProgress(ueChapters);
          const ueScores = qcmScores.filter((s) => s.chapter_id && ueChapters.some((c) => c.id === s.chapter_id));
          const avg = avgScorePct(ueScores);
          const done = ueChapters.filter((c) => c.status === "done").length;
          const ongoing = ueChapters.filter((c) => c.status === "ongoing").length;
          return (
            <div
              key={ue.id}
              onClick={() => onOpenUe(ue)}
              className="hcard"
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderLeft: `3px solid ${ue.color}`,
                borderRadius: 3,
                padding: 16,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 10, color: ue.color ?? undefined, fontWeight: 800, letterSpacing: 1.5, marginBottom: 3 }}>{ue.code}</div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 700, lineHeight: 1.3, maxWidth: 150, color: "var(--text)" }}>
                    {ue.name}
                  </div>
                </div>
                <div style={{ border: `1px solid ${ue.color}`, color: ue.color ?? undefined, borderRadius: 2, padding: "3px 8px", fontSize: 12, fontWeight: 700, fontFamily: "var(--font-mono)", flexShrink: 0 }}>
                  {pct}%
                </div>
              </div>
              <div style={{ background: "var(--track)", borderRadius: 2, height: 4, marginBottom: 10, overflow: "hidden" }}>
                <div className="pfill" style={{ width: `${pct}%`, height: "100%", background: ue.color ?? undefined }} />
              </div>
              <div style={{ display: "flex", gap: 10, fontSize: 11, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ color: "var(--accent-green)", fontWeight: 600 }}>{done} ✓</span>
                {ongoing > 0 && <span style={{ color: "var(--accent-yellow)", fontWeight: 600 }}>{ongoing} ◑</span>}
                {avg !== null && (
                  <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 12 }}>∅ {avg}%</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          onClick={() => onNavigate("timer")}
          style={{ flex: 1, minWidth: 130, padding: 13, background: "var(--accent-blue)", color: "#fff", border: "none", borderRadius: 2, fontSize: 13, fontWeight: 600, letterSpacing: 0.2 }}
        >
          Démarrer une session
        </button>
        <button
          onClick={() => onNavigate("agenda")}
          style={{ flex: 1, minWidth: 130, padding: 13, background: "var(--accent-purple)", color: "#fff", border: "none", borderRadius: 2, fontSize: 13, fontWeight: 600, letterSpacing: 0.2 }}
        >
          Agenda de révision
        </button>
      </div>
    </div>
  );
}
