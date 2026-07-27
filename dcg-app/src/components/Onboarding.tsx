import { useEffect, useState } from "react";
import * as api from "../lib/api";
import { DEFAULT_EXAM_DATE } from "../lib/examPlan";
import { useAppState } from "../state/AppState";

export function Onboarding() {
  const { ready, ues, refreshAll } = useAppState();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [examDate, setExamDate] = useState(DEFAULT_EXAM_DATE);
  const [focus, setFocus] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!ready) return;
    api.getMeta("onboarding_complete").then((value) => setOpen(value !== "1"));
  }, [ready]);
  useEffect(() => { if (ues.length && !focus.length) setFocus(ues.slice(0, Math.min(3, ues.length)).map((ue) => ue.id)); }, [ues, focus.length]);

  const finish = async () => {
    setSaving(true);
    await Promise.all([
      api.setMeta("student_name", name.trim()),
      api.setMeta("exam_date", examDate),
      api.setMeta("focus_ue_ids", JSON.stringify(focus)),
      api.setMeta("onboarding_complete", "1"),
    ]);
    await refreshAll(); setSaving(false); setOpen(false);
  };

  if (!open) return null;
  return <div className="onboarding-backdrop"><div className="onboarding-card">
    <div className="onboarding-progress">{[0,1,2,3].map((index) => <i key={index} className={index <= step ? "active" : ""} />)}</div>
    {step === 0 && <section><small>BIENVENUE DANS DCG ÉTUDE</small><h1>Un plan calme jusqu'au 30 mai 2027.</h1><p>L'application prépare chaque journée, conserve tes leçons sur cette machine et transforme les erreurs en prochaines actions.</p><button className="primary-button" onClick={() => setStep(1)}>Configurer mon parcours →</button></section>}
    {step === 1 && <section><small>TON PARCOURS</small><h1>Comment veux-tu être accueilli ?</h1><label>Prénom<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Ton prénom" /></label><label>Date de l'examen<input type="date" value={examDate} onChange={(event) => setExamDate(event.target.value)} /></label><div className="onboarding-actions"><button className="soft-button" onClick={() => setStep(0)}>Retour</button><button className="primary-button" disabled={!name.trim() || !examDate} onClick={() => setStep(2)}>Continuer →</button></div></section>}
    {step === 2 && <section><small>TES PRIORITÉS</small><h1>Quelles UE travailles-tu maintenant ?</h1><p>Le plan quotidien cherchera d'abord le prochain chapitre dans ces UE. Tu pourras toujours ouvrir les autres depuis Programme.</p><div className="onboarding-ues">{ues.map((ue) => <label key={ue.id} className={focus.includes(ue.id) ? "selected" : ""}><input type="checkbox" checked={focus.includes(ue.id)} onChange={() => setFocus((current) => current.includes(ue.id) ? current.filter((id) => id !== ue.id) : [...current, ue.id])} /><span style={{ background: ue.color || "var(--accent-blue)" }} /><div><b>{ue.code}</b><small>{ue.name}</small></div></label>)}</div><div className="onboarding-actions"><button className="soft-button" onClick={() => setStep(1)}>Retour</button><button className="primary-button" disabled={!focus.length} onClick={() => setStep(3)}>Continuer →</button></div></section>}
    {step === 3 && <section><small>PREMIÈRE ÉTAPE</small><h1>Ton espace est prêt.</h1><div className="onboarding-recap"><p><b>{focus.length}</b> UE prioritaires</p><p><b>{new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date(`${examDate}T12:00:00`))}</b> date cible</p><p><b>0 appel API</b> tes leçons passent par fichiers JSON</p></div><p>Commence dans Programme : choisis un chapitre, copie son prompt et importe la leçon obtenue.</p><div className="onboarding-actions"><button className="soft-button" onClick={() => setStep(2)}>Retour</button><button className="primary-button" disabled={saving} onClick={finish}>{saving ? "Préparation…" : "Voir mon plan du jour →"}</button></div></section>}
  </div></div>;
}
