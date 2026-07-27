import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import * as api from "../../lib/api";
import { useAppState } from "../../state/AppState";
import type { AnnaleAttempt, Exercice, ExoCorrection } from "../../lib/types";

type Stage = "setup" | "work" | "correction-import" | "result";

function fmtClock(totalSeconds: number) {
  const seconds = Math.max(0, totalSeconds);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function elapsedSecondsSince(sqliteUtc: string) {
  const started = new Date(sqliteUtc.replace(" ", "T") + "Z").getTime();
  return Number.isNaN(started) ? 0 : Math.max(0, Math.floor((Date.now() - started) / 1000));
}

function parseJson(raw: string, label: string) {
  try { return JSON.parse(raw); } catch { throw new Error(`${label} n'est pas un JSON valide.`); }
}

function validateExercise(raw: string): Exercice {
  const data = parseJson(raw, "Le sujet structuré");
  if (!data || typeof data.titre !== "string" || !Array.isArray(data.dossiers) || data.dossiers.length === 0) throw new Error("Le fichier doit contenir un titre et au moins un dossier.");
  for (const [index, dossier] of data.dossiers.entries()) {
    if (!Array.isArray(dossier.questions) || dossier.questions.length === 0) throw new Error(`Le dossier ${index + 1} ne contient aucune question.`);
    for (const question of dossier.questions) if (typeof question.enonce !== "string" || typeof question.points !== "number") throw new Error(`Une question du dossier ${index + 1} n'a pas d'énoncé ou de barème valide.`);
  }
  return data as Exercice;
}

function validateCorrection(raw: string): ExoCorrection {
  const data = parseJson(raw, "La correction");
  if (!data || !Array.isArray(data.corrections) || typeof data.total !== "number") throw new Error("La correction doit contenir la liste des corrections et le total obtenu.");
  for (const item of data.corrections) if (typeof item.note !== "number" || typeof item.bareme !== "number" || typeof item.reponse_attendue !== "string") throw new Error("Chaque correction doit contenir une note, un barème et la réponse attendue.");
  return data as ExoCorrection;
}

function subjectPrompt(ueCode: string, title: string, subject: string) {
  return `Tu structures un sujet d'annale DCG ${ueCode} pour une application locale, sans le résoudre.\n\nTitre : ${title}\n\nRends un fichier JSON téléchargeable nommé dcg-annale.json, sans markdown ni commentaire, avec exactement cette structure :\n{"titre":"...","contexte":"...","dossiers":[{"numero":1,"titre":"...","points":8,"questions":[{"numero":1,"enonce":"...","points":2}]}],"total_points":20}\n\nRecopie fidèlement les questions. Conserve dans le contexte toutes les données et tous les documents nécessaires. Si le barème n'est pas indiqué, répartis les points de façon plausible.\n\nSUJET :\n${subject}`;
}

function correctionPrompt(ueCode: string, exercise: Exercice, answers: Record<string, string>, officialCorrection: string | null) {
  return `Tu corriges une copie de DCG ${ueCode} selon le barème du sujet. Rends un fichier JSON téléchargeable nommé dcg-correction.json, sans markdown ni commentaire, avec exactement cette structure :\n{"corrections":[{"dossier":1,"question":1,"note":1.5,"bareme":2,"evaluation":"...","reponse_attendue":"..."}],"total":12.5,"appreciation":"..."}\n\nExige la règle et son application. Une réponse vide vaut 0. Ne dépasse jamais le barème.\n\nSUJET STRUCTURÉ :\n${JSON.stringify(exercise)}\n\nCOPIE DU CANDIDAT :\n${JSON.stringify(answers)}${officialCorrection ? `\n\nCORRIGÉ OFFICIEL À UTILISER COMME RÉFÉRENCE :\n${officialCorrection}` : ""}`;
}

export function AnnaleModal({ resume, onClose }: { resume: AnnaleAttempt | null; onClose: () => void }) {
  const { ues, chapters } = useAppState();
  const [stage, setStage] = useState<Stage>(() => resume?.correction_json ? "result" : resume?.exercice_json ? "work" : "setup");
  const [attempt, setAttempt] = useState<AnnaleAttempt | null>(resume);
  const [exercise, setExercise] = useState<Exercice | null>(() => resume?.exercice_json ? parseJson(resume.exercice_json, "Le sujet") : null);
  const [answers, setAnswers] = useState<Record<string, string>>(() => resume?.answers_json ? parseJson(resume.answers_json, "La copie") : {});
  const [correction, setCorrection] = useState<ExoCorrection | null>(() => resume?.correction_json ? parseJson(resume.correction_json, "La correction") : null);
  const [error, setError] = useState("");
  const [promptFallback, setPromptFallback] = useState("");
  const [promptCopied, setPromptCopied] = useState(false);
  const [, tick] = useState(0);
  const subjectFileRef = useRef<HTMLInputElement>(null);
  const correctionFileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ ueId: ues[0]?.id ?? 0, chapterId: 0, title: "", subject: "", corrige: "", duration: 60 });

  const ueCode = useMemo(() => ues.find((ue) => ue.id === (attempt?.ue_id ?? form.ueId))?.code ?? "", [attempt, form.ueId, ues]);
  const remaining = attempt ? attempt.duration_minutes * 60 - elapsedSecondsSince(attempt.started_at) : 0;

  useEffect(() => {
    if (stage !== "work") return;
    const id = window.setInterval(() => tick((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [stage]);

  useEffect(() => {
    if (stage !== "work" || !attempt || !Object.values(answers).some((answer) => answer.trim())) return;
    const id = window.setTimeout(() => void api.patchAnnale(attempt.id, { answers_json: JSON.stringify(answers) }), 1200);
    return () => window.clearTimeout(id);
  }, [answers, attempt, stage]);

  const copyPrompt = async (prompt: string) => {
    const copied = await Promise.race([navigator.clipboard.writeText(prompt).then(() => true).catch(() => false), new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), 800))]);
    if (copied) { setPromptFallback(""); setPromptCopied(true); window.setTimeout(() => setPromptCopied(false), 2500); }
    else setPromptFallback(prompt);
  };

  const importSubject = (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        setError("");
        const parsed = validateExercise(String(reader.result));
        const created = await api.startAnnale({ ue_id: form.ueId, chapter_id: form.chapterId || null, title: form.title.trim(), subject_text: form.subject, corrige_text: form.corrige.trim() || null, duration_minutes: form.duration });
        await api.patchAnnale(created.id, { exercice_json: JSON.stringify(parsed) });
        setAttempt({ ...created, exercice_json: JSON.stringify(parsed) });
        setExercise(parsed);
        setStage("work");
      } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    };
    reader.readAsText(file);
  };

  const prepareCorrection = async () => {
    if (!attempt || !exercise) return;
    await api.patchAnnale(attempt.id, { answers_json: JSON.stringify(answers) });
    setPromptFallback(""); setPromptCopied(false); setStage("correction-import");
  };

  const importCorrection = (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        if (!attempt) return;
        setError("");
        const parsed = validateCorrection(String(reader.result));
        const elapsed = Math.min(elapsedSecondsSince(attempt.started_at), attempt.duration_minutes * 60);
        const completed = await api.completeAnnale(attempt.id, JSON.stringify(parsed), elapsed);
        setCorrection(parsed); setAttempt(completed); setStage("result");
      } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    };
    reader.readAsText(file);
  };

  const weakCount = correction?.corrections.filter((item) => item.bareme > 0 && item.note < item.bareme * .5).length ?? 0;

  return (
    <div className="annale-modal">
      <div className="desktop-page" style={{ maxWidth: 860, padding: "34px 24px 80px" }}>
        <header className="annale-modal-head"><div><div className="eyebrow">Entraînement hors ligne</div><div className="work-title" style={{ fontSize: 30 }}>{attempt?.title ?? "Nouvelle annale"}</div></div><div>{stage === "work" && attempt && <span className={`annale-clock${remaining < 300 ? " urgent" : ""}`}>{remaining <= 0 ? "Temps écoulé" : fmtClock(remaining)}</span>}<button className="soft-button" onClick={onClose}>Fermer</button></div></header>
        {error && <div className="annale-error">{error}</div>}

        {stage === "setup" && <section className="surface annale-setup">
          <h2>1. Prépare le sujet</h2><p>Colle le sujet réel, copie le prompt dans ton LLM, puis importe le fichier structuré. Aucun appel au modèle n'est fait par l'application.</p>
          <div className="annale-fields">
            <div className="annale-field-pair"><select value={form.ueId} onChange={(event) => setForm((value) => ({ ...value, ueId: Number(event.target.value), chapterId: 0 }))} style={fieldStyle}>{ues.map((ue) => <option key={ue.id} value={ue.id}>{ue.code} · {ue.name}</option>)}</select><select value={form.chapterId} onChange={(event) => setForm((value) => ({ ...value, chapterId: Number(event.target.value) }))} style={fieldStyle}><option value={0}>Chapitre non précisé</option>{chapters.filter((chapter) => chapter.ue_id === form.ueId).map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.name}</option>)}</select></div>
            <input value={form.title} onChange={(event) => setForm((value) => ({ ...value, title: event.target.value }))} placeholder="Titre — ex. DCG UE4 2025, dossier 2" style={fieldStyle} />
            <textarea value={form.subject} onChange={(event) => setForm((value) => ({ ...value, subject: event.target.value }))} placeholder="Colle ici le sujet complet…" rows={9} style={fieldStyle} />
            <textarea value={form.corrige} onChange={(event) => setForm((value) => ({ ...value, corrige: event.target.value }))} placeholder="Optionnel : corrigé officiel" rows={3} style={fieldStyle} />
            <div className="annale-actions"><label>Durée <input type="number" min={5} max={300} step={5} value={form.duration} onChange={(event) => setForm((value) => ({ ...value, duration: Number(event.target.value) }))} style={{ ...fieldStyle, width: 85 }} /> min</label><button className="soft-button" disabled={!form.title.trim() || !form.subject.trim()} onClick={() => copyPrompt(subjectPrompt(ueCode, form.title, form.subject))}>{promptCopied ? "Prompt copié ✓" : "Copier le prompt"}</button><input ref={subjectFileRef} type="file" accept=".json,application/json" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) importSubject(file); }} /><button className="primary-button" disabled={!form.title.trim() || !form.subject.trim()} onClick={() => subjectFileRef.current?.click()}>Importer dcg-annale.json</button></div>
          </div>
          {promptFallback && <textarea readOnly value={promptFallback} rows={7} onFocus={(event) => event.target.select()} style={{ ...fieldStyle, marginTop: 12 }} />}
        </section>}

        {stage === "work" && exercise && <><section className="surface annale-subject"><h2>{exercise.titre}</h2><p>{exercise.contexte}</p></section>{exercise.dossiers.map((dossier) => <section key={dossier.numero} className="surface annale-dossier"><header><strong>Dossier {dossier.numero} — {dossier.titre}</strong><span>{dossier.points} pts</span></header>{dossier.questions.map((question) => { const key = `${dossier.numero}-${question.numero}`; return <label key={key}><span><b>Q{question.numero}</b> ({question.points} pts) — {question.enonce}</span><textarea value={answers[key] ?? ""} onChange={(event) => setAnswers((value) => ({ ...value, [key]: event.target.value }))} rows={4} placeholder="Ta réponse…" style={fieldStyle} /></label>; })}</section>)}<div className="annale-work-actions"><button className="soft-button" onClick={onClose}>Mettre en pause</button><button className="primary-button" onClick={prepareCorrection}>Rendre la copie →</button></div></>}

        {stage === "correction-import" && attempt && exercise && <section className="surface annale-setup"><h2>2. Fais corriger ta copie</h2><p>Le chrono est arrêté. Copie le prompt de correction dans ton LLM, puis importe le fichier obtenu. Les réponses faibles rejoindront automatiquement ton carnet d'erreurs.</p><div className="annale-actions"><button className="soft-button" onClick={() => copyPrompt(correctionPrompt(ueCode, exercise, answers, attempt.corrige_text))}>{promptCopied ? "Prompt copié ✓" : "Copier le prompt de correction"}</button><input ref={correctionFileRef} type="file" accept=".json,application/json" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) importCorrection(file); }} /><button className="primary-button" onClick={() => correctionFileRef.current?.click()}>Importer dcg-correction.json</button></div>{promptFallback && <textarea readOnly value={promptFallback} rows={9} onFocus={(event) => event.target.select()} style={{ ...fieldStyle, marginTop: 12 }} />}</section>}

        {stage === "result" && attempt && <><section className="surface annale-result"><small>RÉSULTAT</small><strong>{attempt.score ?? 0} <span>/ {attempt.total ?? 0}</span></strong>{correction?.appreciation && <p>{correction.appreciation}</p>}{weakCount > 0 && <em>{weakCount} réponse{weakCount > 1 ? "s" : ""} faible{weakCount > 1 ? "s" : ""} ajoutée{weakCount > 1 ? "s" : ""} au carnet d'erreurs.</em>}</section>{correction?.corrections.map((item, index) => { const weak = item.bareme > 0 && item.note < item.bareme * .5; return <section key={index} className={`surface correction-row${weak ? " weak" : ""}`}><header><b>DOSSIER {item.dossier} · QUESTION {item.question}</b><strong>{item.note}/{item.bareme}</strong></header><p>{item.evaluation}</p><p><b>Attendu :</b> {item.reponse_attendue}</p></section>; })}<button className="primary-button" style={{ width: "100%" }} onClick={onClose}>Terminer</button></>}
      </div>
    </div>
  );
}

const fieldStyle: CSSProperties = { width: "100%", background: "var(--input)", border: "1px solid var(--input-border)", borderRadius: 6, padding: "10px 12px", color: "var(--text)", fontSize: 13, lineHeight: 1.55 };
