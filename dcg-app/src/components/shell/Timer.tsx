import { useEffect, useRef, useState } from "react";
import { useAppState } from "../../state/AppState";
import * as api from "../../lib/api";
import { fmtDuration } from "../../lib/format";

const PRESETS: [string, number][] = [
  ["15 min", 15 * 60],
  ["30 min", 30 * 60],
  ["1 heure", 3600],
  ["2 heures", 7200],
  ["3 heures", 3 * 3600],
];

export function Timer() {
  const { ues, timerSessions, refreshAll } = useAppState();
  const [secsLeft, setSecsLeft] = useState(3 * 3600);
  const [max, setMax] = useState(3 * 3600);
  const [running, setRunning] = useState(false);
  const [ueId, setUeId] = useState<number | "">("");
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (running) {
      if (!startedAt) setStartedAt(new Date().toISOString());
      intervalRef.current = window.setInterval(() => {
        setSecsLeft((s) => {
          if (s <= 1) {
            setRunning(false);
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running, startedAt]);

  const elapsed = max - secsLeft;
  const pct = max > 0 ? (elapsed / max) * 100 : 0;
  const r = 85;
  const circ = 2 * Math.PI * r;
  const ue = ueId ? ues.find((u) => u.id === ueId) : null;
  const accent = ue?.color || "var(--accent-blue)";

  const reset = async () => {
    if (elapsed > 60 && startedAt) {
      await api.addTimerSession(ueId ? Number(ueId) : null, null, presetLabel(max), elapsed, startedAt, new Date().toISOString());
      await refreshAll();
    }
    setRunning(false);
    setSecsLeft(max);
    setStartedAt(null);
  };

  return (
    <div className="desktop-page narrow timer-page">
      <div className="work-header" style={{ marginBottom: 24 }}><div><div className="eyebrow">Travail concentré</div><div className="work-title" style={{ fontSize: 34 }}>Chronomètre de session</div><div className="work-lead">Session DCG standard : 3 heures. Pose un cadre, puis travaille sans te disperser.</div></div></div>

      <div className="timer-dial-wrap" style={{ display: "flex", justifyContent: "center", marginBottom: 28 }}>
        <div className="timer-dial surface" style={{ position: "relative", width: 216, height: 216 }}>
          <svg width="216" height="216" style={{ transform: "rotate(-90deg)" }}>
            <circle cx="108" cy="108" r={r} fill="none" stroke="var(--track)" strokeWidth="13" />
            <circle
              cx="108"
              cy="108"
              r={r}
              fill="none"
              stroke={accent}
              strokeWidth="13"
              strokeDasharray={circ}
              strokeDashoffset={circ - (pct / 100) * circ}
              style={{ transition: "stroke-dashoffset 1s linear" }}
            />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 34, fontWeight: 700, letterSpacing: -1, color: "var(--text)" }}>{fmtDuration(secsLeft)}</div>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.5, marginTop: 6, color: running ? "var(--accent-green)" : "var(--muted)" }}>
              {running ? <span className="blk">EN COURS</span> : secsLeft === max ? "PRÊT" : "EN PAUSE"}
            </div>
            {ue && <div style={{ fontSize: 10, color: ue.color ?? undefined, fontWeight: 700, marginTop: 4 }}>{ue.code}</div>}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", display: "block", marginBottom: 7, letterSpacing: 1.5 }}>UE TRAVAILLÉE (OPTIONNEL)</label>
        <select
          value={ueId}
          onChange={(e) => setUeId(e.target.value ? Number(e.target.value) : "")}
          style={{ width: "100%", background: "var(--input)", border: "1px solid var(--input-border)", borderRadius: 2, padding: "10px 14px", color: "var(--text)", fontSize: 14 }}
        >
          <option value="">— Session libre, pas d'UE —</option>
          {ues.map((u) => (
            <option key={u.id} value={u.id}>
              {u.code} · {u.name}
            </option>
          ))}
        </select>
      </div>

      <div className="timer-controls" style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <button
          onClick={() => setRunning((r) => !r)}
          style={{ flex: 1, fontSize: 14, padding: 14, fontWeight: 700, background: running ? "var(--accent-red)" : "var(--accent-green)", color: "#fff", border: "none", borderRadius: 2 }}
        >
          {running ? "Pause" : "Démarrer"}
        </button>
        <button
          onClick={reset}
          style={{ padding: "14px 18px", background: "var(--input)", border: "1px solid var(--input-border)", borderRadius: 2, fontSize: 14, fontWeight: 600, color: "var(--text)" }}
        >
          ↺ Reset
        </button>
      </div>

      <div className="timer-presets" style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 800, letterSpacing: 1.5, marginBottom: 8 }}>DURÉE RAPIDE</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {PRESETS.map(([l, s]) => (
            <button
              key={l}
              onClick={() => {
                setRunning(false);
                setSecsLeft(s);
                setMax(s);
                setStartedAt(null);
              }}
              style={{
                background: max === s && secsLeft === s ? "color-mix(in srgb, var(--accent-blue) 15%, transparent)" : "transparent",
                border: `1px solid ${max === s && secsLeft === s ? "var(--accent-blue)" : "var(--border)"}`,
                borderRadius: 2,
                padding: "8px 14px",
                color: max === s && secsLeft === s ? "var(--accent-blue)" : "var(--muted)",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {timerSessions.length > 0 && (
        <div className="timer-history surface" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 3, padding: 20, marginBottom: 20 }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 700, marginBottom: 12, color: "var(--text)" }}>Sessions récentes</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {timerSessions.slice(0, 8).map((s) => {
              const su = ues.find((u) => u.id === s.ue_id);
              return (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: "var(--card2)", borderRadius: 2, border: "1px solid var(--border)" }}>
                  <div style={{ width: 9, height: 9, background: su?.color || "var(--muted)", flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{su?.name || "—"}</div>
                    <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 1 }}>{s.started_at.slice(0, 10)}</div>
                  </div>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)", flexShrink: 0 }}>{fmtDuration(s.duration_seconds)}</span>
                  <button
                    onClick={async () => {
                      await api.deleteTimerSession(s.id);
                      await refreshAll();
                    }}
                    style={{ background: "none", border: "none", color: "var(--accent-red)", fontSize: 18, cursor: "pointer", padding: "0 3px" }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function presetLabel(seconds: number): string {
  const match = PRESETS.find(([, s]) => s === seconds);
  return match ? match[0] : "custom";
}
