import { useEffect, useMemo, useState, type CSSProperties } from "react";
import * as api from "../../lib/api";
import { genJson } from "../tutor/llm";
import { useAppState } from "../../state/AppState";
import type { AnnaleAttempt, Exercice, ExoCorrection } from "../../lib/types";

/** Entraînement annale: paste a real past exam paper, work it against the
 * clock, get corrected on the barème. Two LLM calls total — one to structure
 * the pasted subject into dossiers/questions, one to correct the copy
 * (guided by the official corrigé when pasted). Weak answers land in the
 * carnet d'erreurs server-side (source « annale »). */

type Stage = "setup" | "structuring" | "work" | "correcting" | "result";

const structureSys = (ueCode: string) =>
  `Tu structures un sujet d'annale DCG ${ueCode} en JSON, sans le résoudre.
Réponds UNIQUEMENT en JSON pur : {"titre":"...","contexte":"...","dossiers":[{"numero":1,"titre":"...","points":8,"questions":[{"numero":1,"enonce":"...","points":2}]}],"total_points":20}
Recopie fidèlement les énoncés des questions, sans les reformuler ni les résumer. Le contexte reprend les informations communes (documents, données chiffrées) nécessaires pour répondre. Si le barème n'est pas indiqué dans le sujet, répartis les points de façon plausible.`;

const correctionSys = (ueCode: string, hasCorrige: boolean) =>
  `Tu es correcteur du DCG ${ueCode}. Corrige la copie d'un candidat selon le barème du sujet.${
    hasCorrige ? " Un corrigé officiel est fourni : appuie-toi dessus comme référence de correction." : ""
  }
Réponds UNIQUEMENT en JSON pur : {"corrections":[{"dossier":1,"question":1,"note":1.5,"bareme":2,"evaluation":"...","reponse_attendue":"..."}],"total":12.5,"appreciation":"..."}
Note comme à l'examen : exige la règle ET son application chiffrée. Une réponse vide vaut 0. "evaluation" dit en 1-2 phrases ce qui va et ce qui manque ; "reponse_attendue" donne la réponse complète attendue.`;

function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** SQLite's datetime('now') is UTC without timezone marker. */
function elapsedSecondsSince(sqliteUtc: string): number {
  const started = new Date(sqliteUtc.replace(" ", "T") + "Z").getTime();
  if (Number.isNaN(started)) return 0;
  return Math.max(0, Math.floor((Date.now() - started) / 1000));
}

export function AnnaleModal({ resume, onClose }: { resume: AnnaleAttempt | null; onClose: () => void }) {
  const { ues, chapters, model } = useAppState();
  const [stage, setStage] = useState<Stage>(() => (resume ? (resume.correction_json ? "result" : "structuring") : "setup"));
  const [attempt, setAttempt] = useState<AnnaleAttempt | null>(resume);
  const [exercice, setExercice] = useState<Exercice | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [correction, setCorrection] = useState<ExoCorrection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);

  const [form, setForm] = useState({
    ueId: ues[0]?.id ?? 0,
    chapterId: 0,
    title: "",
    subject: "",
    corrige: "",
    duration: 60,
  });

  const ueCode = useMemo(() => {
    const id = attempt?.ue_id ?? form.ueId;
    return ues.find((ue) => ue.id === id)?.code ?? "";
  }, [attempt, form.ueId, ues]);

  // ── resume: rehydrate stored progress, (re)structure if needed ──
  useEffect(() => {
    if (!resume) return;
    if (resume.correction_json) {
      try {
        setCorrection(JSON.parse(resume.correction_json));
      } catch {
        /* view still shows score/total from the row */
      }
      if (resume.exercice_json) {
        try {
          setExercice(JSON.parse(resume.exercice_json));
        } catch {
          /* result view tolerates a missing subject */
        }
      }
      return;
    }
    if (resume.answers_json) {
      try {
        setAnswers(JSON.parse(resume.answers_json));
      } catch {
        /* drafts lost — the subject itself is still there */
      }
    }
    if (resume.exercice_json) {
      try {
        setExercice(JSON.parse(resume.exercice_json));
        setStage("work");
        return;
      } catch {
        /* fall through to re-structuring */
      }
    }
    structure(resume);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const structure = async (a: AnnaleAttempt) => {
    setStage("structuring");
    setError(null);
    try {
      const ex = await genJson<Exercice>(structureSys(ues.find((u) => u.id === a.ue_id)?.code ?? ""), a.subject_text, 8000, model);
      setExercice(ex);
      await api.patchAnnale(a.id, { exercice_json: JSON.stringify(ex) });
      setStage("work");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage("work"); // show the error in place, with a retry button
    }
  };

  const start = async () => {
    if (!form.title.trim() || !form.subject.trim() || !form.ueId) return;
    setError(null);
    try {
      const created = await api.startAnnale({
        ue_id: form.ueId,
        chapter_id: form.chapterId || null,
        title: form.title.trim(),
        subject_text: form.subject,
        corrige_text: form.corrige.trim() || null,
        duration_minutes: form.duration,
      });
      setAttempt(created);
      await structure(created);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // ── the clock ──
  const remaining = attempt ? attempt.duration_minutes * 60 - elapsedSecondsSince(attempt.started_at) : 0;
  useEffect(() => {
    if (stage !== "work") return;
    const id = window.setInterval(() => tick((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, [stage]);

  // ── debounced draft autosave, same pattern as the tutor's ExoPhase ──
  useEffect(() => {
    if (stage !== "work" || !attempt || !Object.values(answers).some((a) => a?.trim())) return;
    const id = setTimeout(() => {
      api.patchAnnale(attempt.id, { answers_json: JSON.stringify(answers) });
    }, 1500);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers]);

  const submit = async () => {
    if (!attempt || !exercice) return;
    setStage("correcting");
    setError(null);
    try {
      await api.patchAnnale(attempt.id, { answers_json: JSON.stringify(answers) });
      const corr = await genJson<ExoCorrection>(
        correctionSys(ueCode, !!attempt.corrige_text),
        JSON.stringify({
          sujet: exercice,
          reponses_du_candidat: answers,
          ...(attempt.corrige_text ? { corrige_officiel: attempt.corrige_text } : {}),
        }),
        8000,
        model,
      );
      const elapsed = Math.min(elapsedSecondsSince(attempt.started_at), attempt.duration_minutes * 60);
      const completed = await api.completeAnnale(attempt.id, JSON.stringify(corr), elapsed);
      setAttempt(completed);
      setCorrection(corr);
      setStage("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage("work");
    }
  };

  const quit = async () => {
    // An in-progress attempt stays resumable — quitting is not abandoning.
    onClose();
  };

  const weakCount = correction?.corrections?.filter((c) => (c.bareme ?? 0) > 0 && (c.note ?? 0) < (c.bareme ?? 0) * 0.5).length ?? 0;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 400, overflowY: "auto", background: "var(--bg)" }}>
      <div className="desktop-page" style={{ maxWidth: 860, padding: "34px 24px 80px", margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, marginBottom: 22 }}>
          <div>
            <div className="eyebrow">Entraînement en conditions d'examen</div>
            <div className="work-title" style={{ fontSize: 30 }}>{attempt ? attempt.title : "Nouvelle annale"}</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexShrink: 0 }}>
            {stage === "work" && attempt && (
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 22,
                  fontWeight: 700,
                  padding: "6px 12px",
                  borderRadius: 4,
                  border: `1px solid ${remaining <= 0 ? "var(--accent-red)" : remaining < 300 ? "var(--accent-yellow)" : "var(--border)"}`,
                  color: remaining <= 0 ? "var(--accent-red)" : remaining < 300 ? "var(--accent-yellow)" : "var(--text)",
                }}
              >
                {remaining <= 0 ? "Temps écoulé" : fmtClock(remaining)}
              </div>
            )}
            <button className="soft-button" onClick={quit}>Fermer</button>
          </div>
        </div>

        {error && (
          <div style={{ border: "1px solid var(--accent-red)", color: "var(--accent-red)", borderRadius: 2, padding: "10px 12px", fontSize: 12, lineHeight: 1.5, marginBottom: 16 }}>
            {error}
            {stage === "work" && !exercice && attempt && (
              <button className="text-action" style={{ marginLeft: 10 }} onClick={() => structure(attempt)}>Réessayer →</button>
            )}
          </div>
        )}

        {stage === "setup" && (
          <section className="surface" style={{ padding: 22 }}>
            <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
              Colle le texte d'un sujet d'annale (ou d'un extrait), choisis une durée réaliste, puis travaille sans
              support — exactement comme le jour de l'épreuve. La correction suit le barème ; chaque réponse faible
              rejoint le carnet d'erreurs.
            </p>
            <div style={{ display: "grid", gap: 11 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <select value={form.ueId} onChange={(e) => setForm((f) => ({ ...f, ueId: Number(e.target.value), chapterId: 0 }))} style={fieldStyle}>
                  {ues.map((ue) => <option key={ue.id} value={ue.id}>{ue.code} · {ue.name}</option>)}
                </select>
                <select value={form.chapterId} onChange={(e) => setForm((f) => ({ ...f, chapterId: Number(e.target.value) }))} style={fieldStyle}>
                  <option value={0}>Chapitre non précisé</option>
                  {chapters.filter((c) => c.ue_id === form.ueId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Titre — ex. DCG UE4 2023, dossier 2 (TVA)"
                style={fieldStyle}
              />
              <textarea
                value={form.subject}
                onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                placeholder="Colle ici le texte du sujet (contexte, documents, questions)…"
                rows={10}
                style={fieldStyle}
              />
              <textarea
                value={form.corrige}
                onChange={(e) => setForm((f) => ({ ...f, corrige: e.target.value }))}
                placeholder="Optionnel : colle le corrigé officiel — la correction s'en servira comme référence."
                rows={4}
                style={fieldStyle}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <label style={{ fontSize: 12, color: "var(--muted)" }}>Durée</label>
                <input
                  type="number"
                  min={5}
                  max={300}
                  step={5}
                  value={form.duration}
                  onChange={(e) => setForm((f) => ({ ...f, duration: Number(e.target.value) }))}
                  style={{ ...fieldStyle, width: 90 }}
                />
                <span style={{ fontSize: 12, color: "var(--muted)" }}>minutes</span>
                <button
                  className="primary-button"
                  style={{ marginLeft: "auto", minWidth: 200 }}
                  disabled={!form.title.trim() || !form.subject.trim()}
                  onClick={start}
                >
                  Lancer le chrono →
                </button>
              </div>
            </div>
          </section>
        )}

        {stage === "structuring" && <Wait text="Mise en forme du sujet (dossiers, questions, barème)…" />}
        {stage === "correcting" && <Wait text="Correction de ta copie selon le barème…" />}

        {stage === "work" && exercice && (
          <>
            <section className="surface" style={{ padding: 20, marginBottom: 16 }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 19, color: "var(--text)", marginBottom: 8 }}>{exercice.titre}</div>
              <p style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{exercice.contexte}</p>
            </section>
            {(exercice.dossiers ?? []).map((dossier) => (
              <section key={dossier.numero} className="surface" style={{ padding: 20, marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)" }}>Dossier {dossier.numero} — {dossier.titre}</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)", flexShrink: 0 }}>{dossier.points} pts</div>
                </div>
                {(dossier.questions ?? []).map((question) => {
                  const key = `${dossier.numero}-${question.numero}`;
                  return (
                    <div key={key} style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.55, marginBottom: 7 }}>
                        <strong>Q{question.numero}</strong> <span style={{ color: "var(--muted)", fontSize: 11 }}>({question.points} pts)</span> — {question.enonce}
                      </div>
                      <textarea
                        value={answers[key] ?? ""}
                        onChange={(e) => setAnswers((a) => ({ ...a, [key]: e.target.value }))}
                        rows={4}
                        placeholder="Ta réponse…"
                        style={fieldStyle}
                      />
                    </div>
                  );
                })}
              </section>
            ))}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="soft-button" onClick={quit}>Mettre en pause (reprise possible)</button>
              <button className="primary-button" style={{ minWidth: 220 }} onClick={submit}>
                Rendre la copie → correction
              </button>
            </div>
          </>
        )}

        {stage === "result" && attempt && (
          <>
            <section className="surface" style={{ padding: 22, marginBottom: 16, textAlign: "center" }}>
              <div className="section-kicker" style={{ marginBottom: 10 }}>Résultat</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 40, color: "var(--text)" }}>
                {attempt.score ?? 0} <span style={{ fontSize: 20, color: "var(--muted)" }}>/ {attempt.total ?? 0}</span>
              </div>
              {correction?.appreciation && (
                <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6, maxWidth: 560, margin: "10px auto 0" }}>{correction.appreciation}</p>
              )}
              {weakCount > 0 && (
                <p style={{ color: "var(--accent-yellow)", fontSize: 12, marginTop: 10 }}>
                  {weakCount} réponse{weakCount > 1 ? "s" : ""} faible{weakCount > 1 ? "s" : ""} ajoutée{weakCount > 1 ? "s" : ""} au carnet d'erreurs (et au paquet de cartes).
                </p>
              )}
            </section>
            {(correction?.corrections ?? []).map((item, i) => {
              const weak = (item.bareme ?? 0) > 0 && (item.note ?? 0) < (item.bareme ?? 0) * 0.5;
              return (
                <section key={i} className="surface" style={{ padding: 16, marginBottom: 10, borderLeft: `3px solid ${weak ? "var(--accent-red)" : "var(--accent-green)"}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)" }}>DOSSIER {item.dossier} · QUESTION {item.question}</div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: weak ? "var(--accent-red)" : "var(--accent-green)", flexShrink: 0 }}>
                      {item.note}/{item.bareme}
                    </div>
                  </div>
                  <p style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.6, marginBottom: 6 }}>{item.evaluation}</p>
                  <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
                    <strong style={{ color: "var(--text)" }}>Attendu :</strong> {item.reponse_attendue}
                  </p>
                </section>
              );
            })}
            <button className="primary-button" style={{ width: "100%", marginTop: 8 }} onClick={onClose}>
              Terminer
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Wait({ text }: { text: string }) {
  return (
    <section className="surface" style={{ padding: 40, textAlign: "center" }}>
      <div className="blk" style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--text)", marginBottom: 8 }}>…</div>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>{text}</p>
    </section>
  );
}

const fieldStyle: CSSProperties = {
  width: "100%",
  background: "var(--input)",
  border: "1px solid var(--input-border)",
  borderRadius: 2,
  padding: "10px 12px",
  color: "var(--text)",
  fontSize: 13,
  lineHeight: 1.55,
};
