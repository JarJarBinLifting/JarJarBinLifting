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
            DCG{" "}
            <span
              style={{
                background: "linear-gradient(125deg,#5B9CF7,#B57BF7)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Étude
            </span>
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
            borderRadius: 10,
            padding: "9px 13px",
            fontSize: 18,
            lineHeight: 1,
            color: "var(--text)",
          }}
        >
          {theme === "dark" ? "☀️" : "🌙"}
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
            background: "color-mix(in srgb, var(--accent-blue) 8%, var(--card))",
            border: "1px solid color-mix(in srgb, var(--accent-blue) 35%, var(--border))",
            borderRadius: 16,
            padding: "18px 20px",
          }}
        >
          <div style={{ fontSize: 10, color: "var(--accent-blue)", fontWeight: 800, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 14 }}>
            ⏳ Compte à rebours — Session DCG
          </div>
          {cd.passed ? (
            <p style={{ fontSize: 14, color: "var(--text)" }}>La date est passée — mets-la à jour dans Réglages.</p>
          ) : (
            <div style={{ display: "flex", gap: 24, alignItems: "baseline", flexWrap: "wrap", marginBottom: 12 }}>
              {[{ l: "Jours", v: cd.days }, { l: "Heures", v: cd.hours }, { l: "Minutes", v: cd.minutes }].map(({ l, v }) => (
                <div key={l}>
                  <span style={{ fontFamily: "var(--font-display)", fontSize: 46, fontWeight: 800, color: "var(--accent-blue)", lineHeight: 1 }}>
                    {v}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 700, marginLeft: 5, letterSpacing: 0.5 }}>{l}</span>
                </div>
              ))}
            </div>
          )}
          <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
            Chaque heure de révision est un investissement sur votre réussite.{" "}
            <strong style={{ color: "var(--text)" }}>Vous y arriverez ! 🎯</strong>
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
            borderRadius: 16,
            padding: "14px 18px",
            color: "var(--muted)",
            fontSize: 13,
          }}
        >
          ⏳ Ajoute ta date d'examen dans Réglages pour voir le compte à rebours.
        </button>
      )}

      {dueChapters.length > 0 && (
        <button
          onClick={() => onNavigate("agenda")}
          style={{
            width: "100%",
            marginBottom: 18,
            textAlign: "left",
            background: "color-mix(in srgb, var(--accent-yellow) 10%, var(--card))",
            border: "1px solid color-mix(in srgb, var(--accent-yellow) 40%, var(--border))",
            borderRadius: 16,
            padding: "14px 18px",
            color: "var(--text)",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
            🔄 {dueToday.length > 0 ? `${dueToday.length} chapitre${dueToday.length > 1 ? "s" : ""} à réviser aujourd'hui` : `${dueChapters.length} chapitre${dueChapters.length > 1 ? "s" : ""} à réviser cette semaine`}
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
          const glow = `${ue.color}22`;
          return (
            <div
              key={ue.id}
              onClick={() => onOpenUe(ue)}
              className="hcard"
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderLeft: `4px solid ${ue.color}`,
                borderRadius: 16,
                padding: 16,
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: -25,
                  right: -18,
                  width: 80,
                  height: 80,
                  borderRadius: "50%",
                  background: glow,
                  pointerEvents: "none",
                }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 10, color: ue.color ?? undefined, fontWeight: 800, letterSpacing: 1.5, marginBottom: 3 }}>{ue.code}</div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 700, lineHeight: 1.3, maxWidth: 150, color: "var(--text)" }}>
                    {ue.name}
                  </div>
                </div>
                <div style={{ background: glow, color: ue.color ?? undefined, borderRadius: 8, padding: "4px 9px", fontSize: 13, fontWeight: 700, fontFamily: "var(--font-mono)", flexShrink: 0 }}>
                  {pct}%
                </div>
              </div>
              <div style={{ background: "var(--track)", borderRadius: 99, height: 6, marginBottom: 10, overflow: "hidden" }}>
                <div className="pfill" style={{ width: `${pct}%`, height: "100%", background: ue.color ?? undefined, borderRadius: 99 }} />
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
          style={{ flex: 1, minWidth: 130, padding: 13, background: "var(--accent-blue)", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 600 }}
        >
          ⏱ Démarrer une session
        </button>
        <button
          onClick={() => onNavigate("agenda")}
          style={{ flex: 1, minWidth: 130, padding: 13, background: "var(--accent-purple)", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 600 }}
        >
          📅 Agenda de révision
        </button>
      </div>
    </div>
  );
}
