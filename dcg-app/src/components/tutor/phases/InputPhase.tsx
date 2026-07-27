import { useEffect, useRef, useState } from "react";
import * as api from "../../../lib/api";
import { useAppState } from "../../../state/AppState";
import type { LessonVersion } from "../../../lib/types";
import { DIFFS, type Diff } from "../prompts";
import { buildLessonPrompt, inspectLessonFile, type LessonFile, type LessonInspection } from "../lesson";

export function InputPhase({
  chapterId,
  chapterName,
  ueCode,
  onStartLesson,
}: {
  chapterId: number;
  chapterName: string;
  ueCode: string;
  onStartLesson: (lesson: LessonFile, adhd: boolean, lessonVersionId: number) => void;
}) {
  const { refreshAll } = useAppState();
  const [diff, setDiff] = useState<Diff>(DIFFS[0]);
  const [adhd, setAdhd] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const [promptFallback, setPromptFallback] = useState("");
  const [lessonError, setLessonError] = useState("");
  const [lessonName, setLessonName] = useState("");
  const [inspection, setInspection] = useState<LessonInspection | null>(null);
  const [rawLesson, setRawLesson] = useState("");
  const [versions, setVersions] = useState<LessonVersion[]>([]);
  const [saving, setSaving] = useState(false);
  const lref = useRef<HTMLInputElement>(null);
  const activeVersion = versions.find((version) => version.is_active) ?? null;

  useEffect(() => {
    api.listLessonVersions(chapterId).then(setVersions).catch(() => setVersions([]));
  }, [chapterId]);

  const copyLessonPrompt = async () => {
    const prompt = buildLessonPrompt(ueCode, chapterName, diff);
    const copied = await Promise.race([
      navigator.clipboard.writeText(prompt).then(() => true).catch(() => false),
      new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), 800)),
    ]);
    if (copied) {
      setPromptFallback("");
      setPromptCopied(true);
      window.setTimeout(() => setPromptCopied(false), 3000);
    } else {
      setPromptFallback(prompt);
    }
  };

  const handleLessonFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setLessonError("");
    setInspection(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = String(reader.result);
        setLessonName(file.name);
        setRawLesson(raw);
        setInspection(inspectLessonFile(raw, chapterName, ueCode));
      } catch (error) {
        setLessonName(file.name);
        setLessonError(error instanceof Error ? error.message : String(error));
      }
    };
    reader.onerror = () => setLessonError("Impossible de lire ce fichier. Essaie de le télécharger à nouveau depuis le LLM.");
    reader.readAsText(file);
  };

  const resetLesson = () => {
    setInspection(null);
    setRawLesson("");
    setLessonName("");
    setLessonError("");
  };

  return (
    <div className="tutor-card lesson-import-card">
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: "var(--t-acc)", letterSpacing: 1.1, marginBottom: 6 }}>PRÉPARER LA LEÇON</div>
        <h2 style={{ fontFamily: "var(--font-story)", fontSize: 20, color: "var(--t-pri)", marginBottom: 6 }}>{chapterName}</h2>
        <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.5, margin: 0 }}>
          Crée la leçon avec le LLM de ton choix, puis vérifie-la ici avant de commencer.
        </p>
      </div>

      {activeVersion && !inspection && (
        <div className="lesson-existing">
          <div><small>LEÇON PRÊTE · VERSION {activeVersion.version_number}</small><strong>{activeVersion.source || chapterName}</strong><p>{activeVersion.story_steps} notions · {activeVersion.flashcard_count} cartes · {activeVersion.qcm_count} questions · {activeVersion.difficulty}</p></div>
          <button className="tutor-bp" onClick={() => onStartLesson(inspectLessonFile(activeVersion.raw_json, chapterName, ueCode).lesson, adhd, activeVersion.id)}>Étudier cette version →</button>
        </div>
      )}

      <div className="lesson-steps">
        <section className="lesson-step">
          <span className="lesson-step-number">1</span>
          <div>
            <strong>Choisis le niveau du QCM</strong>
            <select value={diff} onChange={(event) => setDiff(event.target.value as Diff)} className="lesson-select">
              {DIFFS.map((difficulty) => <option key={difficulty}>{difficulty}</option>)}
            </select>
          </div>
        </section>

        <section className="lesson-step">
          <span className="lesson-step-number">2</span>
          <div>
            <strong>Génère le fichier avec ton LLM</strong>
            <p>Copie le prompt, colle-le dans une nouvelle conversation et joins le texte ou le PDF complet du chapitre.</p>
            <button className="tutor-bo" onClick={copyLessonPrompt}>
              {promptCopied ? "Prompt copié ✓" : "Copier le prompt de la leçon"}
            </button>
            {promptFallback && (
              <div style={{ marginTop: 8 }}>
                <p style={{ margin: "0 0 4px", fontSize: 12, color: "var(--muted)" }}>Sélectionne et copie ce prompt :</p>
                <textarea className="tutor-tf" readOnly value={promptFallback} rows={6} onFocus={(event) => event.target.select()} />
              </div>
            )}
          </div>
        </section>

        <section className="lesson-step">
          <span className="lesson-step-number">3</span>
          <div>
            <strong>Importe et vérifie la leçon</strong>
            <p>L'application contrôle la structure, le chapitre, les cartes et les réponses du QCM avant de démarrer.</p>
            <input type="file" ref={lref} onChange={handleLessonFile} accept=".json,application/json" style={{ display: "none" }} />
            <button className="tutor-bo" onClick={() => lref.current?.click()}>{inspection ? "Choisir un autre fichier" : "Importer dcg-lecon.json"}</button>
          </div>
        </section>
      </div>

      {lessonError && (
        <div className="lesson-validation lesson-validation-error">
          <strong>Le fichier « {lessonName} » doit être corrigé</strong>
          <p>{lessonError}</p>
          <p>Retourne dans la conversation du LLM, colle ce message d'erreur et demande-lui de régénérer uniquement le fichier JSON.</p>
        </div>
      )}

      {inspection && (
        <div className="lesson-validation lesson-validation-ok">
          <div className="lesson-validation-head">
            <div><small>FICHIER VALIDÉ</small><strong>{lessonName}</strong></div>
            <button className="text-action" onClick={resetLesson}>Retirer</button>
          </div>
          <div className="lesson-preview-stats">
            <span><b>{inspection.stats.storySteps}</b> notions</span>
            <span><b>{inspection.stats.flashcards}</b> cartes</span>
            <span><b>{inspection.stats.qcmQuestions}</b> questions</span>
            <span><b>{inspection.stats.sourceReferences}</b> extraits source</span>
          </div>
          <div className="lesson-preview-meta">
            <span>Niveau : <b>{inspection.lesson.difficulty}</b></span>
            {inspection.lesson.source && <span>Source : <b>{inspection.lesson.source}</b></span>}
            {inspection.lesson.generated_with && <span>Généré avec : <b>{inspection.lesson.generated_with}</b></span>}
          </div>
          {inspection.warnings.length > 0 && (
            <div className="lesson-warnings">
              <strong>À vérifier avant de commencer</strong>
              {inspection.warnings.map((warning) => <p key={warning}>• {warning}</p>)}
            </div>
          )}
        </div>
      )}

      <label className={`tutor-adhd-card${adhd ? " on" : ""}`} style={{ marginTop: 14 }}>
        <input type="checkbox" checked={adhd} onChange={(event) => setAdhd(event.target.checked)} style={{ marginTop: 3 }} />
        <div>
          <strong style={{ fontSize: 13, color: adhd ? "var(--t-pri)" : "var(--text)" }}>Mode concentration</strong>
          <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>Micro-blocs, animations réduites et pauses faciles.</p>
        </div>
      </label>

      <button
        className="tutor-bp"
        disabled={!inspection || saving}
        onClick={async () => {
          if (!inspection || !rawLesson) return;
          setSaving(true);
          try {
            const saved = await api.importLessonVersion(chapterId, rawLesson, inspection.warnings.length);
            setVersions((current) => [saved, ...current.map((version) => ({ ...version, is_active: false }))]);
            await refreshAll();
            onStartLesson(inspection.lesson, adhd, saved.id);
          } catch (error) {
            setLessonError(error instanceof Error ? error.message : String(error));
          } finally {
            setSaving(false);
          }
        }}
        style={{ width: "100%", marginTop: 14, padding: "13px 24px", fontSize: 15 }}
      >
        {saving ? "Enregistrement de la version…" : inspection ? `Enregistrer comme version ${versions.length + 1} et commencer →` : "Importe une leçon pour commencer"}
      </button>
      <p style={{ textAlign: "center", color: "var(--muted)", fontSize: 11, margin: "10px 0 0" }}>Aucune connexion à un modèle n'est utilisée pendant la session.</p>
    </div>
  );
}
