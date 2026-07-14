import { useEffect, useState } from "react";
import { useAppState } from "../../state/AppState";
import { useTheme } from "../../lib/theme";
import * as api from "../../lib/api";
import { avgScorePct, chapterProgress, computeStudyStreak, countdownTo, daysSinceLastActivity } from "../../lib/format";
import type { Chapter, Ue, WeakChapter } from "../../lib/types";
import { StatTile } from "./common";
import type { ShellView } from "./Nav";

/** Days since the last activity at or above which the smart-start banner
 * switches to "gentle re-entry" framing instead of plain quick-start. */
const GAP_THRESHOLD_DAYS = 3;

type QuickStartReason = "gentle" | "weak" | "due" | "next";

const REASON_LABEL: Record<QuickStartReason, string> = {
  gentle: "REPRISE EN DOUCEUR",
  weak: "DÉMARRAGE RAPIDE — POINT FAIBLE",
  due: "DÉMARRAGE RAPIDE — À RÉVISER",
  next: "DÉMARRAGE RAPIDE — PROCHAIN CHAPITRE",
};

function pickQuickStart(
  chapters: Chapter[],
  weak: WeakChapter[],
  dueChapterIds: number[],
  gapDays: number | null,
): { chapter: Chapter; reason: QuickStartReason } | null {
  const byId = (id: number) => chapters.find((c) => c.id === id);

  if (gapDays !== null && gapDays >= GAP_THRESHOLD_DAYS) {
    const revisable = weak.find((w) => w.box_level != null);
    const c = revisable && byId(revisable.chapter_id);
    if (c) return { chapter: c, reason: "gentle" };
  }
  if (weak.length > 0) {
    const c = byId(weak[0].chapter_id);
    if (c) return { chapter: c, reason: "weak" };
  }
  if (dueChapterIds.length > 0) {
    const c = byId(dueChapterIds[0]);
    if (c) return { chapter: c, reason: "due" };
  }
  const next = chapters.find((c) => c.status === "ongoing") ?? chapters.find((c) => c.status === "todo");
  return next ? { chapter: next, reason: "next" } : null;
}

export function Dashboard({
  onOpenUe,
  onNavigate,
  onQuickStart,
}: {
  onOpenUe: (ue: Ue) => void;
  onNavigate: (v: ShellView) => void;
  onQuickStart: (chapter: Chapter) => void;
}) {
  const { ues, chapters, qcmScores, timerSessions, dueChapters, examDate } = useAppState();
  const { theme, toggle } = useTheme();
  const [, forceTick] = useState(0);
  const [weak, setWeak] = useState<WeakChapter[]>([]);

  // re-render every minute so the countdown stays live without a full data refetch
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    api.listWeakChapters().then(setWeak);
  }, [dueChapters]);

  const totalDone = chapters.filter((c) => c.status === "done").length;
  const gAvg = avgScorePct(qcmScores);
  const cd = examDate ? countdownTo(examDate) : null;
  const dueToday = dueChapters.filter((d) => d.next_review_date <= new Date().toISOString().slice(0, 10));

  const activityDates = [...timerSessions.map((s) => s.ended_at), ...qcmScores.map((s) => s.date)];
  const streak = computeStudyStreak(activityDates);
  const gapDays = daysSinceLastActivity(activityDates);
  const quickStart = pickQuickStart(
    chapters,
    weak,
    dueChapters.map((d) => d.chapter_id),
    gapDays,
  );
  const quickStartUe = quickStart ? ues.find((u) => u.id === quickStart.chapter.ue_id) : null;

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
            {streak > 0 && (
              <span style={{ marginLeft: 10, color: "var(--accent-yellow)" }}>
                · {streak} JOUR{streak > 1 ? "S" : ""} DE SUITE
              </span>
            )}
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

      {quickStart && quickStartUe && (
        <button
          onClick={() => onQuickStart(quickStart.chapter)}
          style={{
            width: "100%",
            marginBottom: 16,
            padding: "16px 18px",
            textAlign: "left",
            background: "var(--accent-blue)",
            color: "#fff",
            border: "none",
            borderRadius: 3,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.2, opacity: 0.85, marginBottom: 4 }}>
              {REASON_LABEL[quickStart.reason]}
            </div>
            {quickStart.reason === "gentle" && (
              <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 4 }}>
                Ça fait {gapDays} jour{(gapDays ?? 0) > 1 ? "s" : ""} — pas de souci, on reprend en douceur.
              </div>
            )}
            <div style={{ fontSize: 15, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {quickStart.chapter.name}
            </div>
            <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>{quickStartUe.code} · {quickStartUe.name}</div>
          </div>
          <span style={{ fontSize: 22, fontWeight: 700, flexShrink: 0 }}>→</span>
        </button>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10, marginBottom: 16 }}>
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
