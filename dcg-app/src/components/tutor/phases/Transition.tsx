import { useEffect, useState } from "react";
import { TutorSpin } from "../shared";

const BREAK_SECONDS = 120;

function BreakTimer({ onDone }: { onDone: () => void }) {
  const [left, setLeft] = useState(BREAK_SECONDS);
  useEffect(() => {
    if (left <= 0) return;
    const id = setInterval(() => setLeft((l) => l - 1), 1000);
    return () => clearInterval(id);
  }, [left]);
  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  return (
    <div style={{ textAlign: "center", padding: "10px 0" }}>
      {left > 0 ? (
        <>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.5, color: "var(--t-acc)", marginBottom: 8 }}>PAUSE</div>
          <div style={{ fontSize: 32, fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--t-acc)" }}>
            {mm}:{ss}
          </div>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "8px 0 12px", lineHeight: 1.6 }}>
            Lève-toi, bois un verre d'eau, regarde par la fenêtre.
            <br />
            L'appli t'attend — rien ne sera perdu.
          </p>
          <button className="tutor-bs" onClick={onDone}>
            Écourter la pause
          </button>
        </>
      ) : (
        <>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.5, color: "var(--t-ok)", marginBottom: 8 }}>PAUSE TERMINÉE</div>
          <p style={{ fontSize: 14, fontWeight: 600, color: "var(--t-ok)", margin: "0 0 12px" }}>On reprend en douceur.</p>
          <button className="tutor-bp" onClick={onDone}>
            C'est reparti →
          </button>
        </>
      )}
    </div>
  );
}

export interface TransitionSpec {
  title: string;
  lines: string[];
  cta: string;
  loading?: boolean;
  loadingText?: string;
}

export function Transition({ spec, adhd, onContinue }: { spec: TransitionSpec; adhd: boolean; onContinue: () => void }) {
  const [mode, setMode] = useState<"recap" | "break">("recap");
  return (
    <div className="tutor-card tutor-trans-box">
      {mode === "recap" ? (
        <>
          <h3 style={{ fontFamily: "var(--font-story)", fontSize: 18, color: "var(--t-pri)", marginBottom: 6 }}>{spec.title}</h3>
          {spec.lines.length > 0 && (
            <div className="tutor-trans-recap">
              {spec.lines.map((l, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: i < spec.lines.length - 1 ? 6 : 0 }}>
                  <span style={{ flexShrink: 0, color: "var(--t-pri)" }}>—</span>
                  <span>{l}</span>
                </div>
              ))}
            </div>
          )}
          {spec.loading ? (
            <TutorSpin text={spec.loadingText || "Préparation…"} />
          ) : (
            <div style={{ display: "flex", gap: 8, flexDirection: adhd ? "column" : "row" }}>
              {adhd && (
                <button className="tutor-bo" onClick={() => setMode("break")} style={{ width: "100%" }}>
                  Pause de 2 min d'abord
                </button>
              )}
              <button className="tutor-bp" onClick={onContinue} style={{ width: "100%" }}>
                {spec.cta} →
              </button>
            </div>
          )}
        </>
      ) : (
        <BreakTimer onDone={() => setMode("recap")} />
      )}
    </div>
  );
}
