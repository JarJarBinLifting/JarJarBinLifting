import { useCallback, useEffect, useRef, useState } from "react";
import { genChat, genJson } from "../llm";
import { prompts } from "../prompts";
import type { Exercice, ExoCorrection } from "../../../lib/types";
import { Consigne, TutorError, TutorSpin } from "../shared";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

export function ExoPhase({
  sys,
  ue,
  model,
  adhd,
  onNext,
  onHint,
  celebrate,
  onExercice,
}: {
  sys: string;
  ue: string;
  model: string;
  adhd: boolean;
  onNext: (got: number, total: number) => void;
  onHint: (hint: string) => void;
  celebrate: (emoji: string) => void;
  onExercice: (exercice: Exercice, correction: ExoCorrection | null) => void;
}) {
  const [ex, setEx] = useState<(Exercice & { error?: string }) | null>(null);
  const [ldEx, setLdEx] = useState(true);
  const [ans, setAns] = useState<Record<string, string>>({});
  const [correction, setCorrection] = useState<(ExoCorrection & { error?: string }) | null>(null);
  const [ldC, setLdC] = useState(false);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [dossIdx, setDossIdx] = useState(0);
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [fu, setFu] = useState("");
  const [ldChat, setLdChat] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const chatMsgsRef = useRef<ChatMsg[]>(chatMsgs);
  chatMsgsRef.current = chatMsgs;

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [chatMsgs]);

  useEffect(() => {
    (async () => {
      try {
        const data = await genJson<Exercice>(sys, "Génère l'exercice.", 6000, model);
        setEx(data);
      } catch (e: any) {
        setEx({ error: e?.message ?? String(e) } as any);
      }
      setLdEx(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sys]);

  useEffect(() => {
    if (ex && !ex.error) onHint(correction ? "Application — lecture de la correction" : adhd ? `Application — dossier ${dossIdx + 1}/${ex.dossiers?.length || 1}` : "Application — rédaction du cas pratique");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ex, correction, dossIdx, adhd]);

  const exText = ex && !ex.error
    ? `${ex.titre}\n${ex.contexte}\n` +
      (ex.dossiers || []).map((d) => `Dossier ${d.numero}: ${d.titre} (${d.points}pts)\n` + d.questions.map((q) => `Q${q.numero} (${q.points}pts): ${q.enonce}`).join("\n")).join("\n\n")
    : "";

  const submit = async () => {
    if (!ex || ex.error) return;
    setLdC(true);
    const student = (ex.dossiers || [])
      .map((d) => d.questions.map((q) => `Dossier ${d.numero} Q${q.numero}: ${ans[`${d.numero}-${q.numero}`] || "(non répondu)"}`).join("\n"))
      .join("\n");
    try {
      const c = await genJson<ExoCorrection>(prompts.corrJSON(ue, exText), `Ma copie:\n${student}`, 6000, model);
      setCorrection(c);
      onExercice(ex, c);
      celebrate("");
    } catch (e: any) {
      setCorrection({ error: e?.message ?? String(e) } as any);
    }
    setLdC(false);
  };

  const ask = useCallback(
    async (t: string) => {
      const n = [...chatMsgsRef.current, { role: "user" as const, content: t }];
      setChatMsgs(n);
      setFu("");
      setLdChat(true);
      try {
        const r = await genChat(prompts.corrChat(ue, exText), n, 1500, model, true);
        setChatMsgs((p) => [...p, { role: "assistant", content: r }]);
      } catch (e: any) {
        setChatMsgs((p) => [...p, { role: "assistant", content: `Erreur: ${e?.message ?? e}` }]);
      }
      setLdChat(false);
    },
    [ue, exText, model],
  );

  if (ldEx) return <div className="tutor-card"><TutorSpin text="Préparation du sujet — même entreprise que l'histoire…" /></div>;
  if (!ex) return null;
  if (ex.error) return <div className="tutor-card"><TutorError message={ex.error} /></div>;

  const dossiers = ex.dossiers || [];
  const totalPts = correction?.corrections?.reduce((s, c) => s + (c.bareme || 0), 0) || 20;
  const gotPts = correction?.total ?? correction?.corrections?.reduce((s, c) => s + (c.note || 0), 0) ?? 0;
  const notePct = totalPts > 0 ? Math.round((gotPts / totalPts) * 100) : 0;
  const visibleDossiers = adhd && !correction && !ldC ? [dossiers[dossIdx]].filter(Boolean) : dossiers;

  return (
    <div className="tutor-card">
      <div style={{ textAlign: "center", marginBottom: 12 }}>
        <h3 style={{ fontFamily: "var(--font-story)", fontSize: 17, color: "var(--t-pri)" }}>Application — Cas pratique</h3>
      </div>
      {!correction && !ldC && <Consigne text={adhd ? "Un dossier à la fois — rédige ce que tu peux, même partiel" : "Rédige comme à l'examen — le tuteur corrigera chaque question"} />}
      <div style={{ background: "var(--t-acl)", padding: 14, borderRadius: 3, borderLeft: "4px solid var(--t-acc)", marginBottom: 14 }}>
        <h4 style={{ margin: "0 0 5px", fontFamily: "var(--font-story)", fontSize: 16, color: "var(--t-acc)" }}>{ex.titre}</h4>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{ex.contexte}</p>
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <span style={{ background: "var(--card)", color: "var(--t-acc)", fontSize: 11, padding: "2px 9px", border: "1px solid var(--t-acc)", borderRadius: 2, fontWeight: 600 }}>{ex.total_points} pts</span>
        </div>
      </div>

      {adhd && !correction && !ldC && dossiers.length > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
          <div style={{ flex: 1, background: "var(--track)", borderRadius: 2, height: 4, overflow: "hidden" }}>
            <div className="pfill" style={{ width: `${((dossIdx + 1) / dossiers.length) * 100}%`, height: "100%", background: "var(--t-acc)" }} />
          </div>
          <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>dossier {dossIdx + 1}/{dossiers.length}</span>
        </div>
      )}

      {!correction &&
        !ldC &&
        visibleDossiers.map((d) => (
          <div key={d.numero} style={{ background: "var(--card2)", padding: 14, borderRadius: 3, border: "1px solid var(--border)", marginBottom: 10 }}>
            <h4 style={{ margin: "0 0 10px", fontSize: 14, color: "var(--t-pri)" }}>
              Dossier {d.numero} — {d.titre}{" "}
              <span style={{ background: "var(--t-prl)", color: "var(--t-pri)", fontSize: 11, padding: "2px 9px", border: "1px solid var(--t-pri)", borderRadius: 2, fontWeight: 600 }}>{d.points} pts</span>
            </h4>
            {d.questions.map((q) => (
              <div key={q.numero} style={{ marginBottom: 10 }}>
                <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 5, lineHeight: 1.55 }}>
                  Q{q.numero} <span style={{ color: "var(--muted)", fontWeight: 400 }}>({q.points} pts)</span> — {q.enonce}
                </p>
                <textarea
                  className="tutor-tf"
                  value={ans[`${d.numero}-${q.numero}`] || ""}
                  onChange={(e) => setAns({ ...ans, [`${d.numero}-${q.numero}`]: e.target.value })}
                  placeholder="Ta réponse…"
                  rows={3}
                />
              </div>
            ))}
          </div>
        ))}

      {!correction &&
        !ldC &&
        (adhd && dossIdx < dossiers.length - 1 ? (
          <button
            className="tutor-bp"
            onClick={() => {
              setDossIdx(dossIdx + 1);
              celebrate("");
            }}
            style={{ width: "100%" }}
          >
            Dossier suivant →
          </button>
        ) : (
          <button className="tutor-bp" onClick={submit} disabled={!Object.values(ans).some((a) => a?.trim())} style={{ width: "100%" }}>
            Soumettre pour correction
          </button>
        ))}
      {adhd && !correction && !ldC && dossIdx > 0 && (
        <button className="tutor-bs" onClick={() => setDossIdx(dossIdx - 1)} style={{ width: "100%", marginTop: 8 }}>
          ← Dossier précédent
        </button>
      )}
      {ldC && <TutorSpin text="Le tuteur corrige ta copie…" />}

      {correction && !correction.error && (
        <>
          <div
            style={{
              background: notePct >= 60 ? "var(--t-okb)" : notePct >= 40 ? "var(--t-acl)" : "var(--t-erb)",
              padding: "14px 16px",
              borderRadius: 2,
              textAlign: "center",
              marginBottom: 12,
            }}
          >
            <div style={{ fontSize: 26, fontWeight: 700, fontFamily: "var(--font-mono)", color: notePct >= 60 ? "var(--t-ok)" : notePct >= 40 ? "var(--t-acc)" : "var(--t-err)" }}>
              {gotPts}/{totalPts}
            </div>
            {correction.appreciation && <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.55 }}>{correction.appreciation}</p>}
          </div>
          <Consigne text="Déplie chaque question pour voir le détail et la réponse attendue" />
          {(correction.corrections || []).map((c, i) => {
            const open = openIdx === i;
            const good = c.bareme > 0 && c.note / c.bareme >= 0.7;
            const mid = c.bareme > 0 && c.note / c.bareme >= 0.4;
            return (
              <div key={i} className="tutor-corr-item">
                <div className="tutor-corr-head" onClick={() => setOpenIdx(open ? null : i)}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>D{c.dossier} · Q{c.question}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        background: good ? "var(--t-okb)" : mid ? "var(--t-acl)" : "var(--t-erb)",
                        color: good ? "var(--t-ok)" : mid ? "var(--t-acc)" : "var(--t-err)",
                        fontSize: 11,
                        padding: "2px 9px",
                        border: `1px solid ${good ? "var(--t-ok)" : mid ? "var(--t-acc)" : "var(--t-err)"}`,
                        borderRadius: 2,
                        fontWeight: 600,
                      }}
                    >
                      {c.note}/{c.bareme}
                    </span>
                    <span style={{ color: "var(--muted)", fontSize: 12 }}>{open ? "▲" : "▼"}</span>
                  </span>
                </div>
                {open && (
                  <div className="tutor-corr-body">
                    <p style={{ margin: "0 0 8px" }}>{c.evaluation}</p>
                    <div style={{ background: "var(--t-prl)", padding: "10px 12px", borderRadius: 2, borderLeft: "3px solid var(--t-pri)" }}>
                      <strong style={{ fontSize: 12, color: "var(--t-pri)" }}>Réponse attendue :</strong>
                      <br />
                      {c.reponse_attendue}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <div style={{ marginTop: 12 }}>
            {chatMsgs.length > 0 && (
              <div ref={chatRef} style={{ maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, padding: "6px 0" }}>
                {chatMsgs.map((m, i) => (
                  <div key={i} className={`tutor-cb ${m.role === "user" ? "tutor-cb-u" : "tutor-cb-a"}`}>
                    {m.content}
                  </div>
                ))}
                {ldChat && (
                  <div className="tutor-cb tutor-cb-a" style={{ animation: "pulse 1.5s infinite" }}>
                    …
                  </div>
                )}
              </div>
            )}
            <div style={{ display: "flex", gap: 6, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
              <input
                value={fu}
                onChange={(e) => setFu(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && fu.trim() && !ldChat) ask(fu.trim());
                }}
                placeholder="Question sur la correction…"
                style={{ flex: 1, padding: "9px 12px", borderRadius: 2, border: "1px solid var(--border)", fontSize: 12, color: "var(--text)", background: "var(--input)" }}
              />
              <button className="tutor-bp" style={{ padding: "8px 14px", fontSize: 12 }} disabled={!fu.trim() || ldChat} onClick={() => ask(fu.trim())}>
                OK
              </button>
            </div>
          </div>
          <button className="tutor-bo" onClick={() => onNext(gotPts, totalPts)} style={{ width: "100%", marginTop: 12 }}>
            Voir le bilan →
          </button>
        </>
      )}
      {correction?.error && (
        <>
          <TutorError message={correction.error} />
          <button className="tutor-bo" onClick={() => setCorrection(null)} style={{ width: "100%" }}>
            Réessayer
          </button>
        </>
      )}
    </div>
  );
}
