import { useMemo, useState, type CSSProperties } from "react";
import * as api from "../../lib/api";
import { todayIso } from "../../lib/format";
import { useAppState } from "../../state/AppState";
import type { ErrorNote, ErrorType, ExamSkill } from "../../lib/types";

const SKILLS: { id: ExamSkill; label: string; description: string }[] = [
  { id: "recall", label: "Restitution", description: "Retrouver une règle, formule ou définition sans support." },
  { id: "method", label: "Choix de méthode", description: "Identifier la règle ou démarche pertinente." },
  { id: "application", label: "Application", description: "Appliquer la notion à une situation concrète." },
  { id: "technical", label: "Technique", description: "Calculer, présenter et vérifier sans erreur." },
  { id: "time", label: "Temps", description: "Lire, prioriser et finir dans le temps imparti." },
];

const ERROR_TYPES: { id: ErrorType; label: string }[] = [
  { id: "knowledge", label: "Connaissance" },
  { id: "method", label: "Méthode" },
  { id: "calculation", label: "Calcul / technique" },
  { id: "reading", label: "Lecture du sujet" },
  { id: "time", label: "Gestion du temps" },
];

const LADDER = ["Rappel actif", "Application guidée", "Mini-cas autonome", "Extrait chronométré", "Maîtrisé"];

function markColor(mark: number | null) {
  if (mark === null) return "var(--muted)";
  return mark >= 10 ? "var(--accent-green)" : mark >= 6 ? "var(--accent-yellow)" : "var(--accent-red)";
}

function scoreLabel(score: number | null) {
  return score === null ? "À évaluer" : ["", "Fragile", "À consolider", "Correct", "Sûr"][score] ?? "À évaluer";
}

export function Pilotage() {
  const { ues, chapters, errorNotes, skillProfiles, examScenario, refreshAll } = useAppState();
  const [selectedUeId, setSelectedUeId] = useState<number>(() => ues[0]?.id ?? 0);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorForm, setErrorForm] = useState({
    ueId: ues[0]?.id ?? 0,
    chapterId: 0,
    title: "",
    errorType: "knowledge" as ErrorType,
    skill: "recall" as ExamSkill,
    reasoning: "",
    correction: "",
    source: "annale" as "manual" | "annale",
  });
  const [skillDrafts, setSkillDrafts] = useState<Record<string, number>>({});
  const [scenarioDrafts, setScenarioDrafts] = useState<Record<number, { current: string; target: string }>>({});

  const activeErrors = errorNotes.filter((e) => e.status === "active");
  const dueErrors = activeErrors.filter((e) => e.next_review_date <= todayIso());
  const selectedUe = ues.find((u) => u.id === selectedUeId) ?? ues[0] ?? null;
  const selectedSkills = skillProfiles.filter((row) => row.ue_id === selectedUe?.id);

  const scenario = useMemo(
    () => examScenario.map((row) => ({
      ...row,
      current: scenarioDrafts[row.ue_id]?.current ?? (row.current_mark?.toString() ?? ""),
      target: scenarioDrafts[row.ue_id]?.target ?? (row.target_mark?.toString() ?? ""),
    })),
    [examScenario, scenarioDrafts],
  );
  const currentMarks = examScenario.map((r) => r.current_mark).filter((m): m is number => m !== null);
  const targetMarks = examScenario.map((r) => r.target_mark).filter((m): m is number => m !== null);
  const avg = (marks: number[]) => (marks.length ? marks.reduce((sum, mark) => sum + mark, 0) / marks.length : null);
  const currentAvg = avg(currentMarks);
  const targetAvg = avg(targetMarks);
  const atRisk = examScenario.filter((r) => r.current_mark !== null && r.current_mark < 6);

  const saveError = async () => {
    if (!errorForm.ueId || !errorForm.title.trim()) return;
    setSaving(true);
    try {
      await api.createErrorNote({
        ue_id: errorForm.ueId,
        chapter_id: errorForm.chapterId || null,
        title: errorForm.title,
        error_type: errorForm.errorType,
        skill: errorForm.skill,
        my_reasoning: errorForm.reasoning || null,
        correction: errorForm.correction || null,
        source: errorForm.source,
      });
      setErrorForm((form) => ({ ...form, title: "", reasoning: "", correction: "" }));
      setFormOpen(false);
      await refreshAll();
    } finally {
      setSaving(false);
    }
  };

  const advance = async (error: ErrorNote) => {
    await api.advanceErrorNote(error.id);
    await refreshAll();
  };

  const recordSkill = async (skill: ExamSkill, fallback: number | null) => {
    if (!selectedUe) return;
    const score = skillDrafts[skill] ?? fallback;
    if (!score) return;
    await api.recordSkillAssessment({ ue_id: selectedUe.id, skill, score });
    setSkillDrafts((drafts) => {
      const next = { ...drafts };
      delete next[skill];
      return next;
    });
    await refreshAll();
  };

  const saveScenario = async (ueId: number, current: string, target: string) => {
    const parse = (value: string) => (value.trim() === "" ? null : Number(value));
    await api.setExamScenario(ueId, parse(current), parse(target));
    setScenarioDrafts((drafts) => {
      const next = { ...drafts };
      delete next[ueId];
      return next;
    });
    await refreshAll();
  };

  return (
    <div className="desktop-page pilotage-page" style={{ paddingBottom: 32 }}>
      <div className="work-header" style={{ marginBottom: 24 }}>
        <div><div className="eyebrow">Lecture des risques</div><div className="work-title" style={{ fontSize: 34 }}>Pilotage examen</div>
        <p className="work-lead">
          Transforme chaque erreur en une prochaine action. Les notes ci-dessous sont un scénario sur tes UE suivies, pas une prédiction officielle.
        </p></div>
      </div>

      <section className="pilotage-panel pilotage-priority surface" style={{ background: "var(--card)", border: "1px solid var(--border)", borderLeft: "3px solid var(--accent-red)", borderRadius: 3, padding: 18, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: dueErrors.length ? 12 : 0 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 800, color: "var(--accent-red)", letterSpacing: 1.2, marginBottom: 4 }}>À TRAITER MAINTENANT</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 700, color: "var(--text)" }}>
              {dueErrors.length ? `${dueErrors.length} erreur${dueErrors.length > 1 ? "s" : ""} à transformer en point fort` : "Aucune erreur à revoir aujourd'hui"}
            </div>
          </div>
          <button onClick={() => setFormOpen(true)} style={{ background: "var(--accent-blue)", color: "#fff", border: "none", borderRadius: 2, padding: "9px 12px", fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
            + Noter une erreur
          </button>
        </div>
        {dueErrors.slice(0, 3).map((error) => <ErrorRow key={error.id} error={error} onAdvance={advance} compact />)}
      </section>

      <section className="pilotage-panel surface" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 3, padding: 18, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 700, color: "var(--text)" }}>Compétences d'examen</div>
            <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>Évalue la capacité à réussir le sujet, pas seulement à reconnaître le cours.</p>
          </div>
          <select value={selectedUe?.id ?? ""} onChange={(e) => setSelectedUeId(Number(e.target.value))} style={selectStyle}>
            {ues.map((ue) => <option key={ue.id} value={ue.id}>{ue.code} · {ue.name}</option>)}
          </select>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 9 }}>
          {SKILLS.map((skill) => {
            const profile = selectedSkills.find((row) => row.skill === skill.id);
            const value = skillDrafts[skill.id] ?? profile?.score ?? 0;
            return (
              <div key={skill.id} style={{ background: "var(--card2)", border: "1px solid var(--border)", borderRadius: 2, padding: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text)", marginBottom: 3 }}>{skill.label}</div>
                <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.4, minHeight: 45 }}>{skill.description}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
                  <select value={value} onChange={(e) => setSkillDrafts((d) => ({ ...d, [skill.id]: Number(e.target.value) }))} style={{ ...selectStyle, padding: "7px 8px", fontSize: 11, flex: 1 }}>
                    <option value={0}>À évaluer</option>
                    <option value={1}>1 · Fragile</option>
                    <option value={2}>2 · À consolider</option>
                    <option value={3}>3 · Correct</option>
                    <option value={4}>4 · Sûr</option>
                  </select>
                  <button onClick={() => recordSkill(skill.id, profile?.score ?? null)} disabled={!value} style={{ background: "var(--accent-blue)", border: "none", borderRadius: 2, padding: "7px 9px", color: "#fff", fontSize: 10, fontWeight: 800 }}>
                    OK
                  </button>
                </div>
                {profile?.recorded_at && <div style={{ marginTop: 7, fontSize: 9, color: "var(--muted)" }}>{scoreLabel(profile.score)} · évalué le {profile.recorded_at}</div>}
              </div>
            );
          })}
        </div>
      </section>

      <section className="pilotage-panel surface" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 3, padding: 18, marginBottom: 16 }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 700, color: "var(--text)" }}>Scénario de réussite</div>
        <p style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.5, margin: "4px 0 14px" }}>
          Saisis une note obtenue ou une estimation honnête, puis une cible. Une note sous 6 est un risque à neutraliser en priorité.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 9, marginBottom: 14 }}>
          <Metric label="Moyenne actuelle" value={currentAvg === null ? "—" : currentAvg.toFixed(1)} color={markColor(currentAvg)} />
          <Metric label="Moyenne cible" value={targetAvg === null ? "—" : targetAvg.toFixed(1)} color={markColor(targetAvg)} />
          <Metric label="UE à risque < 6" value={atRisk.length} color={atRisk.length ? "var(--accent-red)" : "var(--accent-green)"} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {scenario.map((row) => (
            <div key={row.ue_id} style={{ display: "grid", gridTemplateColumns: "minmax(120px,1fr) 88px 88px 58px", gap: 8, alignItems: "center", background: "var(--card2)", border: "1px solid var(--border)", borderLeft: `3px solid ${row.ue_color ?? "var(--border)"}`, borderRadius: 2, padding: "8px 10px" }}>
              <div style={{ minWidth: 0 }}><div style={{ fontSize: 10, color: row.ue_color ?? "var(--muted)", fontWeight: 800 }}>{row.ue_code}</div><div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.ue_name}</div></div>
              <input aria-label={`Note actuelle ${row.ue_code}`} type="number" min="0" max="20" step="0.5" placeholder="Actuel" value={row.current} onChange={(e) => setScenarioDrafts((d) => ({ ...d, [row.ue_id]: { current: e.target.value, target: row.target } }))} style={numberStyle} />
              <input aria-label={`Note cible ${row.ue_code}`} type="number" min="0" max="20" step="0.5" placeholder="Cible" value={row.target} onChange={(e) => setScenarioDrafts((d) => ({ ...d, [row.ue_id]: { current: row.current, target: e.target.value } }))} style={numberStyle} />
              <button onClick={() => saveScenario(row.ue_id, row.current, row.target)} style={{ background: "var(--accent-blue)", color: "#fff", border: "none", borderRadius: 2, padding: "8px 4px", fontSize: 10, fontWeight: 800 }}>OK</button>
            </div>
          ))}
        </div>
      </section>

      <section className="pilotage-panel surface" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 3, padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <div><div style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 700, color: "var(--text)" }}>Carnet d'erreurs</div><p style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>{activeErrors.length} erreur{activeErrors.length > 1 ? "s" : ""} active{activeErrors.length > 1 ? "s" : ""} · {errorNotes.filter((e) => e.status === "mastered").length} maîtrisée{errorNotes.filter((e) => e.status === "mastered").length > 1 ? "s" : ""}</p></div>
          <button onClick={() => setFormOpen(true)} style={{ background: "var(--input)", border: "1px solid var(--input-border)", borderRadius: 2, padding: "8px 11px", fontSize: 11, color: "var(--text)", fontWeight: 700 }}>Ajouter</button>
        </div>
        {activeErrors.length ? <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>{activeErrors.slice(0, 12).map((error) => <ErrorRow key={error.id} error={error} onAdvance={advance} />)}</div> : <div style={{ color: "var(--muted)", fontSize: 13, padding: "8px 0" }}>Ajoute une erreur après une annale ou laisse le tuteur alimenter ce carnet avec les QCM ratés.</div>}
      </section>

      {formOpen && (
        <div onClick={() => setFormOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.72)", padding: 16 }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520, width: "100%", maxHeight: "90vh", overflowY: "auto", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 3, padding: 20 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 800, color: "var(--text)", marginBottom: 4 }}>Noter une erreur utile</div>
            <p style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.5, marginBottom: 16 }}>Décris la décision ou le raisonnement qui t'a fait perdre des points. Le carnet crée ensuite les étapes de révision.</p>
            <div style={{ display: "grid", gap: 11 }}>
              <select value={errorForm.ueId} onChange={(e) => setErrorForm((f) => ({ ...f, ueId: Number(e.target.value), chapterId: 0 }))} style={selectStyle}>{ues.map((ue) => <option key={ue.id} value={ue.id}>{ue.code} · {ue.name}</option>)}</select>
              <select value={errorForm.chapterId} onChange={(e) => setErrorForm((f) => ({ ...f, chapterId: Number(e.target.value) }))} style={selectStyle}><option value={0}>Chapitre non précisé</option>{chapters.filter((c) => c.ue_id === errorForm.ueId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              <input autoFocus value={errorForm.title} onChange={(e) => setErrorForm((f) => ({ ...f, title: e.target.value }))} placeholder="Ex. J'ai choisi le mauvais régime de TVA" style={inputStyle} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><select value={errorForm.errorType} onChange={(e) => setErrorForm((f) => ({ ...f, errorType: e.target.value as ErrorType }))} style={selectStyle}>{ERROR_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select><select value={errorForm.skill} onChange={(e) => setErrorForm((f) => ({ ...f, skill: e.target.value as ExamSkill }))} style={selectStyle}>{SKILLS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
              <textarea value={errorForm.reasoning} onChange={(e) => setErrorForm((f) => ({ ...f, reasoning: e.target.value }))} placeholder="Mon raisonnement : ce que j'ai fait ou pensé" rows={3} style={inputStyle} />
              <textarea value={errorForm.correction} onChange={(e) => setErrorForm((f) => ({ ...f, correction: e.target.value }))} placeholder="Méthode correcte / règle à retenir" rows={3} style={inputStyle} />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}><button onClick={() => setFormOpen(false)} style={{ ...buttonSecondary, flex: 1 }}>Annuler</button><button onClick={saveError} disabled={saving || !errorForm.title.trim()} style={{ background: "var(--accent-blue)", color: "#fff", border: "none", borderRadius: 2, padding: 11, fontWeight: 700, flex: 1 }}>{saving ? "Enregistrement…" : "Ajouter au carnet"}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function ErrorRow({ error, onAdvance, compact = false }: { error: ErrorNote; onAdvance: (error: ErrorNote) => void; compact?: boolean }) {
  const step = Math.min(error.ladder_step, LADDER.length - 1);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--card2)", border: "1px solid var(--border)", borderLeft: `3px solid ${error.ue_color ?? "var(--accent-red)"}`, borderRadius: 2, padding: "10px 11px" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: error.ue_color ?? "var(--muted)", marginBottom: 2 }}>{error.ue_code} · {LADDER[step].toUpperCase()}</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", lineHeight: 1.35 }}>{error.title}</div>
        {!compact && <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 3 }}>À revoir : {error.next_review_date} · {ERROR_TYPES.find((t) => t.id === error.error_type)?.label ?? error.error_type}</div>}
      </div>
      <button onClick={() => onAdvance(error)} style={{ background: "var(--accent-blue)", color: "#fff", border: "none", borderRadius: 2, padding: "8px 10px", fontSize: 10, fontWeight: 800, flexShrink: 0 }}>{step >= 3 ? "Maîtrisé" : "Valider →"}</button>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string | number; color: string }) {
  return <div style={{ background: "var(--card2)", border: "1px solid var(--border)", borderRadius: 2, padding: "11px 12px" }}><div style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>{value}</div><div style={{ color: "var(--muted)", fontSize: 9, fontWeight: 800, letterSpacing: .6, marginTop: 5 }}>{label.toUpperCase()}</div></div>;
}

const selectStyle: CSSProperties = { background: "var(--input)", border: "1px solid var(--input-border)", borderRadius: 2, padding: "9px 10px", color: "var(--text)", fontSize: 12 };
const inputStyle: CSSProperties = { width: "100%", background: "var(--input)", border: "1px solid var(--input-border)", borderRadius: 2, padding: "10px 11px", color: "var(--text)", fontSize: 13, lineHeight: 1.5 };
const numberStyle: CSSProperties = { width: "100%", background: "var(--input)", border: "1px solid var(--input-border)", borderRadius: 2, padding: "8px 7px", color: "var(--text)", fontSize: 12 };
const buttonSecondary: CSSProperties = { background: "var(--input)", border: "1px solid var(--input-border)", borderRadius: 2, padding: 11, color: "var(--text)", fontWeight: 700 };
