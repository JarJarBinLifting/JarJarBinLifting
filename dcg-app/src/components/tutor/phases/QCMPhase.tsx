import { useEffect, useState } from "react";
import type { Qcm, QcmQuestion } from "../../../lib/types";
import { TutorSpin, Consigne } from "../shared";

export function QCMPhase({
  qcm,
  difficulty,
  adapted,
  adhd,
  onNext,
  onHint,
  celebrate,
  breakStreak,
}: {
  qcm: Qcm | null;
  difficulty: string;
  adapted: boolean;
  adhd: boolean;
  onNext: (score: number, total: number, missed: QcmQuestion[]) => void;
  onHint: (hint: string) => void;
  celebrate: (emoji: string) => void;
  breakStreak: () => void;
}) {
  const [ans, setAns] = useState<Record<number, number>>({});
  const [done, setDone] = useState(false);
  const [idx, setIdx] = useState(0);
  const [answered, setAnswered] = useState(false);

  const qs = qcm?.questions || [];

  useEffect(() => {
    if (qs.length) onHint(adhd ? `QCM — question ${Math.min(idx + 1, qs.length)}/${qs.length}` : `QCM — ${Object.keys(ans).length}/${qs.length} répondues`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, ans, qs.length, adhd]);

  if (!qs.length) return <div className="tutor-card"><TutorSpin text="QCM en préparation…" /></div>;

  const score = qs.reduce((s, q, i) => s + (ans[i] === q.correct ? 1 : 0), 0);
  const missed = qs.filter((q, i) => ans[i] !== q.correct);

  if (adhd && !done) {
    const q = qs[idx];
    const sel = ans[idx];
    const pick = (oi: number) => {
      if (answered) return;
      setAns({ ...ans, [idx]: oi });
      setAnswered(true);
      if (oi === q.correct) celebrate("✅");
      else breakStreak();
    };
    const next = () => {
      if (idx >= qs.length - 1) {
        setDone(true);
        return;
      }
      setIdx(idx + 1);
      setAnswered(false);
    };
    return (
      <div className="tutor-card">
        <div style={{ textAlign: "center", marginBottom: 12 }}>
          <h3 style={{ fontFamily: "var(--font-story)", fontSize: 17, color: "var(--t-pri)", marginBottom: 4 }}>Vérification — QCM</h3>
          <span style={{ background: "var(--t-acl)", color: "var(--t-acc)", fontSize: 11, padding: "2px 9px", borderRadius: 100, fontWeight: 600 }}>{difficulty}</span>
          {adapted && <span style={{ background: "var(--t-okb)", color: "var(--t-ok)", fontSize: 11, padding: "2px 9px", borderRadius: 100, fontWeight: 600, marginLeft: 6 }}>⬆ adapté</span>}
        </div>
        <Consigne text="Une seule question à la fois — réponds, lis le feedback, avance" />
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14 }}>
          <div style={{ flex: 1, background: "var(--track)", borderRadius: 4, height: 6, overflow: "hidden" }}>
            <div className="pfill" style={{ width: `${((idx + (answered ? 1 : 0)) / qs.length) * 100}%`, height: "100%", background: "var(--t-pri)", borderRadius: 4 }} />
          </div>
          <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>reste {qs.length - idx - (answered ? 1 : 0)}</span>
        </div>
        <div style={{ background: "var(--card2)", padding: 16, borderRadius: 10, border: "1px solid var(--border)" }}>
          <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, lineHeight: 1.6 }}>
            <span style={{ color: "var(--t-pri)", fontFamily: "var(--font-mono)", marginRight: 6 }}>{idx + 1}.</span>
            {q.question}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {q.options.map((o, oi) => {
              let bg = "var(--card)",
                bc = "var(--border)",
                cl = "var(--text)";
              if (answered && oi === q.correct) {
                bg = "var(--t-okb)";
                bc = "var(--t-ok)";
                cl = "var(--t-ok)";
              } else if (answered && sel === oi && oi !== q.correct) {
                bg = "var(--t-erb)";
                bc = "var(--t-err)";
                cl = "var(--t-err)";
              }
              return (
                <button
                  key={oi}
                  disabled={answered}
                  onClick={() => pick(oi)}
                  style={{ textAlign: "left", padding: "11px 13px", borderRadius: 10, border: `1.5px solid ${bc}`, background: bg, color: cl, fontSize: 13, lineHeight: 1.5 }}
                >
                  {o}
                </button>
              );
            })}
          </div>
          {answered && (
            <div className={`tutor-feedback-box ${sel === q.correct ? "tutor-fb-good" : "tutor-fb-partial"}`} style={{ marginBottom: 0 }}>
              <strong>{sel === q.correct ? "✅ Exact !" : "💡 Pas celle-ci — et maintenant tu sais pourquoi :"}</strong>
              <br />
              {q.explication}
            </div>
          )}
        </div>
        {answered && (
          <button className="tutor-bp" onClick={next} style={{ width: "100%", marginTop: 12 }}>
            {idx >= qs.length - 1 ? "Voir mon score →" : "Question suivante →"}
          </button>
        )}
      </div>
    );
  }

  if (adhd && done) {
    return (
      <div className="tutor-card" style={{ textAlign: "center" }}>
        <div style={{ fontSize: 44, marginBottom: 8 }}>{score >= 8 ? "🎉" : score >= 5 ? "📚" : "💪"}</div>
        <h3 style={{ fontFamily: "var(--font-story)", fontSize: 18, color: "var(--t-pri)", marginBottom: 8 }}>QCM terminé !</h3>
        <div style={{ fontSize: 30, fontWeight: 700, fontFamily: "var(--font-mono)", color: score >= 8 ? "var(--t-ok)" : score >= 5 ? "var(--t-acc)" : "var(--t-err)", marginBottom: 12 }}>
          {score}/{qs.length}
        </div>
        {missed.length > 0 && (
          <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>Thèmes à retravailler : {[...new Set(missed.map((q) => q.theme || "Général"))].join(", ")}</p>
        )}
        <button className="tutor-bp" onClick={() => onNext(score, qs.length, missed)} style={{ width: "100%" }}>
          {score >= 8 ? "Approfondir →" : "Travailler mes lacunes →"}
        </button>
      </div>
    );
  }

  const full = Object.keys(ans).length >= qs.length;
  return (
    <div className="tutor-card">
      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <h3 style={{ fontFamily: "var(--font-story)", fontSize: 17, color: "var(--t-pri)", marginBottom: 4 }}>Vérification — QCM</h3>
        <span style={{ background: "var(--t-acl)", color: "var(--t-acc)", fontSize: 11, padding: "2px 9px", borderRadius: 100, fontWeight: 600 }}>{difficulty}</span>
        {adapted && <span style={{ background: "var(--t-okb)", color: "var(--t-ok)", fontSize: 11, padding: "2px 9px", borderRadius: 100, fontWeight: 600, marginLeft: 6 }}>⬆ difficulté adaptée</span>}
      </div>
      {done && (
        <div
          style={{
            background: score >= 8 ? "var(--t-okb)" : score >= 5 ? "var(--t-acl)" : "var(--t-erb)",
            padding: "12px 16px",
            borderRadius: 10,
            textAlign: "center",
            fontSize: 17,
            fontWeight: 600,
            marginBottom: 14,
            color: score >= 8 ? "var(--t-ok)" : score >= 5 ? "var(--t-acc)" : "var(--t-err)",
          }}
        >
          Score : {score}/{qs.length} {score >= 8 ? "🎉" : score >= 5 ? "📚" : "💪"}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {qs.map((q, qi) => (
          <div key={qi} style={{ background: "var(--card2)", padding: 13, borderRadius: 10, border: "1px solid var(--border)" }}>
            <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, lineHeight: 1.55 }}>
              <span style={{ color: "var(--t-pri)", fontFamily: "var(--font-mono)", marginRight: 5 }}>{qi + 1}.</span>
              {q.question}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {q.options.map((o, oi) => {
                let bg = "var(--card)",
                  bc = "var(--border)",
                  cl = "var(--text)";
                if (done && oi === q.correct) {
                  bg = "var(--t-okb)";
                  bc = "var(--t-ok)";
                  cl = "var(--t-ok)";
                } else if (done && ans[qi] === oi && oi !== q.correct) {
                  bg = "var(--t-erb)";
                  bc = "var(--t-err)";
                  cl = "var(--t-err)";
                } else if (!done && ans[qi] === oi) {
                  bg = "var(--t-prl)";
                  bc = "var(--t-pri)";
                }
                return (
                  <button
                    key={oi}
                    disabled={done}
                    onClick={() => setAns({ ...ans, [qi]: oi })}
                    style={{ textAlign: "left", padding: "8px 11px", borderRadius: 6, border: `1.5px solid ${bc}`, background: bg, color: cl, fontSize: 13 }}
                  >
                    {o}
                  </button>
                );
              })}
            </div>
            {done && <p style={{ margin: "7px 0 0", fontSize: 12, color: "var(--muted)", fontStyle: "italic", borderTop: "1px solid var(--border)", paddingTop: 7, lineHeight: 1.5 }}>{q.explication}</p>}
          </div>
        ))}
      </div>
      {!done ? (
        <button className="tutor-bp" disabled={!full} onClick={() => setDone(true)} style={{ width: "100%", marginTop: 14 }}>
          Valider
        </button>
      ) : (
        <button className="tutor-bp" onClick={() => onNext(score, qs.length, missed)} style={{ width: "100%", marginTop: 14 }}>
          {score >= 8 ? "Approfondir →" : "Travailler mes lacunes →"}
        </button>
      )}
    </div>
  );
}
