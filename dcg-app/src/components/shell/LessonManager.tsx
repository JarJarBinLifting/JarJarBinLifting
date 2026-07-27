import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "../../lib/api";
import type { Chapter, LessonFlag, LessonVersion, QcmQuestion } from "../../lib/types";
import type { LessonFile } from "../tutor/lesson";
import { useAppState } from "../../state/AppState";

type EditState = { type: "flashcard" | "qcm"; index: number; recto?: string; verso?: string; correct?: number; explication?: string };

export function LessonManager({ chapter, onClose }: { chapter: Chapter; onClose: () => void }) {
  const { refreshAll } = useAppState();
  const [versions, setVersions] = useState<LessonVersion[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [flags, setFlags] = useState<LessonFlag[]>([]);
  const [view, setView] = useState<"summary" | "cards" | "qcm">("summary");
  const [flagging, setFlagging] = useState<{ type: LessonFlag["item_type"]; index: number | null } | null>(null);
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState<EditState | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (preferId?: number) => {
    const rows = await api.listLessonVersions(chapter.id);
    setVersions(rows);
    setSelectedId(preferId ?? rows.find((row) => row.is_active)?.id ?? rows[0]?.id ?? null);
  }, [chapter.id]);
  useEffect(() => { void load(); }, [load]);
  const selected = versions.find((version) => version.id === selectedId) ?? null;
  const lesson = useMemo(() => selected ? JSON.parse(selected.raw_json) as LessonFile : null, [selected]);
  useEffect(() => { if (selectedId) api.listLessonFlags(selectedId).then(setFlags); else setFlags([]); }, [selectedId]);

  const activate = async (version: LessonVersion) => {
    setBusy(true); await api.activateLessonVersion(version.id); await load(version.id); await refreshAll(); setBusy(false);
  };

  const createFlag = async () => {
    if (!selected || !flagging || !reason.trim()) return;
    setBusy(true); await api.flagLessonItem(selected.id, { item_type: flagging.type, item_index: flagging.index, reason });
    setFlags(await api.listLessonFlags(selected.id)); setReason(""); setFlagging(null); await refreshAll(); setBusy(false);
  };

  const saveRevision = async (action: "correct" | "exclude") => {
    if (!selected || !lesson || !editing) return;
    const revised = JSON.parse(JSON.stringify(lesson)) as LessonFile;
    if (editing.type === "flashcard") {
      if (action === "exclude") revised.flashcards.splice(editing.index, 1);
      else revised.flashcards[editing.index] = { ...revised.flashcards[editing.index], recto: editing.recto?.trim() || revised.flashcards[editing.index].recto, verso: editing.verso?.trim() || revised.flashcards[editing.index].verso };
    } else {
      if (action === "exclude") revised.qcm.questions.splice(editing.index, 1);
      else revised.qcm.questions[editing.index] = { ...revised.qcm.questions[editing.index], correct: editing.correct ?? revised.qcm.questions[editing.index].correct, explication: editing.explication?.trim() || revised.qcm.questions[editing.index].explication };
    }
    if (!revised.flashcards.length || !revised.qcm.questions.length) return;
    revised.generated_at = new Date().toISOString().slice(0, 10);
    revised.generated_with = `${revised.generated_with || "Import"} · correction locale`;
    setBusy(true);
    const next = await api.importLessonVersion(chapter.id, JSON.stringify(revised, null, 2), Math.max(0, selected.warning_count - 1));
    const matching = flags.filter((flag) => flag.status === "active" && flag.item_type === editing.type && flag.item_index === editing.index);
    await Promise.all(matching.map((flag) => api.resolveLessonFlag(flag.id)));
    await load(next.id); await refreshAll(); setEditing(null); setBusy(false);
  };

  return <div className="lesson-manager-backdrop" onClick={onClose}><div className="lesson-manager" onClick={(event) => event.stopPropagation()}>
    <header><div><small>BIBLIOTHÈQUE DE LEÇONS</small><h2>{chapter.name}</h2></div><button className="soft-button" onClick={onClose}>Fermer</button></header>
    {!selected || !lesson ? <div className="queue-empty"><strong>Aucune leçon enregistrée.</strong><p>Ouvre Étudier pour préparer et importer la première version.</p></div> : <>
      <div className="lesson-manager-toolbar"><select value={selected.id} onChange={(event) => setSelectedId(Number(event.target.value))}>{versions.map((version) => <option key={version.id} value={version.id}>Version {version.version_number}{version.is_active ? " · active" : ""} · {version.imported_at.slice(0, 10)}</option>)}</select>{!selected.is_active && <button className="soft-button" disabled={busy} onClick={() => activate(selected)}>Rétablir cette version</button>}</div>
      <div className="lesson-manager-tabs"><button className={view === "summary" ? "active" : ""} onClick={() => setView("summary")}>Résumé</button><button className={view === "cards" ? "active" : ""} onClick={() => setView("cards")}>Flashcards ({lesson.flashcards.length})</button><button className={view === "qcm" ? "active" : ""} onClick={() => setView("qcm")}>QCM ({lesson.qcm.questions.length})</button></div>
      {view === "summary" && <div className="lesson-manager-summary"><div className="lesson-preview-stats"><span><b>{selected.story_steps}</b> notions</span><span><b>{selected.flashcard_count}</b> cartes</span><span><b>{selected.qcm_count}</b> questions</span></div><dl><dt>Source</dt><dd>{selected.source || "Non renseignée"}</dd><dt>Générée avec</dt><dd>{selected.generated_with || "Non renseigné"}</dd><dt>Schéma</dt><dd>v{selected.format_version} · prompt v{selected.prompt_version || "ancien"}</dd><dt>Importée</dt><dd>{selected.imported_at}</dd></dl>{(selected.warning_count > 0 || selected.flag_count > 0) && <div className="lesson-warnings"><strong>Cette version demande une vérification</strong><p>{selected.warning_count} avertissement(s) d'import · {selected.flag_count} signalement(s) actif(s)</p></div>}<button className="soft-button" onClick={() => { setFlagging({ type: "lesson", index: null }); setReason(""); }}>Signaler un problème général</button></div>}
      {view === "cards" && <div className="lesson-item-list">{lesson.flashcards.map((card, index) => <div className="lesson-item" key={`${index}-${card.recto}`}><div><small>CARTE {index + 1}</small><strong>{card.recto}</strong><p>{card.verso}</p></div><div><button onClick={() => { setFlagging({ type: "flashcard", index }); setReason(""); }}>Signaler</button><button onClick={() => setEditing({ type: "flashcard", index, recto: card.recto, verso: card.verso })}>Corriger</button></div></div>)}</div>}
      {view === "qcm" && <div className="lesson-item-list">{lesson.qcm.questions.map((question, index) => <QcmItem key={`${index}-${question.question}`} question={question} index={index} onFlag={() => { setFlagging({ type: "qcm", index }); setReason(""); }} onEdit={() => setEditing({ type: "qcm", index, correct: question.correct, explication: question.explication })} />)}</div>}
      {flags.some((flag) => flag.status === "active") && <div className="lesson-active-flags"><strong>Signalements actifs</strong>{flags.filter((flag) => flag.status === "active").map((flag) => <p key={flag.id}>{flag.item_type}{flag.item_index !== null ? ` ${flag.item_index + 1}` : ""} · {flag.reason}</p>)}</div>}
    </>}
    {flagging && <div className="lesson-editor"><h3>Signaler ce contenu</h3><textarea autoFocus rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Qu'est-ce qui semble faux, ambigu ou dépassé ?" /><div><button className="soft-button" onClick={() => setFlagging(null)}>Annuler</button><button className="primary-button" disabled={!reason.trim() || busy} onClick={createFlag}>Enregistrer</button></div></div>}
    {editing && lesson && <div className="lesson-editor"><h3>{editing.type === "flashcard" ? "Corriger la flashcard" : "Corriger la réponse du QCM"}</h3>{editing.type === "flashcard" ? <><label>Question<input value={editing.recto} onChange={(event) => setEditing({ ...editing, recto: event.target.value })} /></label><label>Réponse<textarea rows={4} value={editing.verso} onChange={(event) => setEditing({ ...editing, verso: event.target.value })} /></label></> : <><label>Bonne option<select value={editing.correct} onChange={(event) => setEditing({ ...editing, correct: Number(event.target.value) })}>{lesson.qcm.questions[editing.index].options.map((option, index) => <option key={option} value={index}>{index + 1} · {option}</option>)}</select></label><label>Explication<textarea rows={4} value={editing.explication} onChange={(event) => setEditing({ ...editing, explication: event.target.value })} /></label></>}<p>La correction créera une nouvelle version et conservera celle-ci dans l'historique.</p><div><button className="danger-button" disabled={busy} onClick={() => saveRevision("exclude")}>Exclure cet élément</button><span /><button className="soft-button" onClick={() => setEditing(null)}>Annuler</button><button className="primary-button" disabled={busy} onClick={() => saveRevision("correct")}>Créer la version corrigée</button></div></div>}
  </div></div>;
}

function QcmItem({ question, index, onFlag, onEdit }: { question: QcmQuestion; index: number; onFlag: () => void; onEdit: () => void }) {
  return <div className="lesson-item"><div><small>QUESTION {index + 1}</small><strong>{question.question}</strong><p>Bonne réponse : {question.options[question.correct]}</p><p>{question.explication}</p></div><div><button onClick={onFlag}>Signaler</button><button onClick={onEdit}>Corriger</button></div></div>;
}
