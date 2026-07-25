import { useState } from "react";
import type { AnnaleAttempt, ErrorNote, ErrorType, ExamSkill } from "../../lib/types";
import {
  ERROR_TYPE_LABELS,
  percent,
  previousCompletedAttempt,
  RECOVERY_LADDER,
  recoveryItems,
  SKILL_LABELS,
} from "./AnnaleRecoveryData";

type RecoveryPlanInput = {
  error_type: ErrorType;
  skill: ExamSkill;
  title: string;
  my_reasoning: string | null;
  correction: string | null;
};

type Props = {
  attempt: AnnaleAttempt;
  attempts: AnnaleAttempt[];
  errors: ErrorNote[];
  onBack: () => void;
  onAdvance: (error: ErrorNote) => Promise<void>;
  onCreatePlan: (plan: RecoveryPlanInput) => Promise<void>;
};

function sourceLabel(item: { dossier: number; question: number; dossierTitle: string | null }) {
  const title = item.dossierTitle ? ` · ${item.dossierTitle}` : "";
  return `Dossier ${item.dossier} · question ${item.question}${title}`;
}

function fallbackProfile(evaluation: string): { errorType: ErrorType; skill: ExamSkill } {
  const label = evaluation.toLowerCase();
  if (label.includes("calcul") || label.includes("techni")) return { errorType: "calculation", skill: "technical" };
  if (label.includes("lecture")) return { errorType: "reading", skill: "method" };
  if (label.includes("temps")) return { errorType: "time", skill: "time" };
  if (label.includes("connaiss")) return { errorType: "knowledge", skill: "recall" };
  return { errorType: "method", skill: "application" };
}

export function AnnaleRecovery({ attempt, attempts, errors, onBack, onAdvance, onCreatePlan }: Props) {
  const items = recoveryItems(attempt, errors);
  const previous = previousCompletedAttempt(attempt, attempts);
  const currentPercent = percent(attempt.score, attempt.total);
  const previousPercent = previous ? percent(previous.score, previous.total) : null;
  const change = currentPercent !== null && previousPercent !== null ? currentPercent - previousPercent : null;

  return (
    <div className="desktop-page annales-page">
      <header className="work-header">
        <div>
          <div className="eyebrow">Après la copie</div>
          <h1 className="work-title">Reprise d’annale</h1>
          <p className="work-lead">Chaque point perdu devient un rappel à produire, une règle à vérifier et une révision programmée. La règle reste masquée jusqu’à ta tentative.</p>
        </div>
        <button className="soft-button" onClick={onBack}>← Retour aux annales</button>
      </header>

      <section className="surface" style={{ padding: 20, marginBottom: 16, borderTop: `3px solid ${attempt.ue_color ?? "var(--accent-blue)"}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <div className="section-kicker">{attempt.ue_code} · copie corrigée</div>
            <h2 style={{ marginTop: 5, color: "var(--text)", fontFamily: "var(--font-display)", fontSize: 23, fontWeight: 500 }}>{attempt.title}</h2>
            <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 5 }}>{items.length} point{items.length > 1 ? "s" : ""} de reprise ciblé{items.length > 1 ? "s" : ""} · aucun nouveau contenu n’est inventé.</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(110px, 1fr))", gap: 8, minWidth: 235 }}>
            <Metric label="Cette copie" value={currentPercent === null ? "—" : `${currentPercent}%`} color={currentPercent !== null && currentPercent >= 50 ? "var(--accent-green)" : "var(--accent-red)"} />
            <Metric label="Évolution UE" value={change === null ? "—" : `${change > 0 ? "+" : ""}${change} pts`} color={change === null ? "var(--muted)" : change >= 0 ? "var(--accent-green)" : "var(--accent-red)"} />
          </div>
        </div>
        {previous && previousPercent !== null && <p style={{ marginTop: 13, color: "var(--muted)", fontSize: 11 }}>Comparaison réelle avec <strong style={{ color: "var(--text)" }}>{previous.title}</strong> : {previousPercent}% → {currentPercent}%.</p>}
      </section>

      <section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 15, margin: "0 0 10px" }}>
          <div><div className="section-kicker">Plan de reprise</div><h2 style={{ color: "var(--text)", font: "500 21px var(--font-display)", marginTop: 3 }}>Du point perdu au prochain rappel</h2></div>
          <span style={{ color: "var(--muted)", fontSize: 10, maxWidth: 250, textAlign: "right" }}>Rappel actif → feedback → répétition espacée SM‑2</span>
        </div>
        {items.length === 0 ? (
          <div className="surface" style={{ padding: 22, color: "var(--muted)", fontSize: 13 }}>
            <strong style={{ display: "block", color: "var(--text)", marginBottom: 5 }}>Aucun point perdu dans cette correction.</strong>
            Cette copie est complète : conserve-la comme référence et varie la prochaine annale pour entrelacer les notions.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 11 }}>
            {items.map((item) => <RecoveryCard
              key={`${item.correction.dossier}-${item.correction.question}`}
              item={item}
              attempt={attempt}
              onAdvance={onAdvance}
              onCreatePlan={onCreatePlan}
            />)}
          </div>
        )}
      </section>
    </div>
  );
}

function RecoveryCard({
  item,
  attempt,
  onAdvance,
  onCreatePlan,
}: {
  item: ReturnType<typeof recoveryItems>[number];
  attempt: AnnaleAttempt;
  onAdvance: (error: ErrorNote) => Promise<void>;
  onCreatePlan: (plan: RecoveryPlanInput) => Promise<void>;
}) {
  const [revealed, setRevealed] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const { correction, error } = item;
  const step = Math.min(error?.ladder_step ?? 0, RECOVERY_LADDER.length - 1);
  const profile = fallbackProfile(correction.evaluation);
  const pointPercent = Math.round((correction.note / correction.bareme) * 100);
  const createPlan = async () => {
    setSaving(true);
    try {
      await onCreatePlan({
        title: `${attempt.title} — ${item.question ?? `D${correction.dossier}Q${correction.question}`}`,
        error_type: profile.errorType,
        skill: profile.skill,
        my_reasoning: null,
        correction: correction.reponse_attendue || null,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="surface" style={{ padding: 18, borderLeft: `3px solid ${pointPercent < 50 ? "var(--accent-red)" : "var(--accent-yellow)"}` }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "var(--muted)", fontSize: 10, fontWeight: 800, letterSpacing: ".45px", textTransform: "uppercase" }}>{sourceLabel({ ...correction, dossierTitle: item.dossierTitle })}</div>
          <h3 style={{ marginTop: 5, color: "var(--text)", fontSize: 14, lineHeight: 1.45 }}>{item.question ?? "Énoncé non structuré : reprends le dossier correspondant."}</h3>
        </div>
        <strong style={{ color: pointPercent < 50 ? "var(--accent-red)" : "var(--accent-yellow)", font: "700 13px var(--font-mono)", whiteSpace: "nowrap" }}>{correction.note}/{correction.bareme}</strong>
      </header>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 11 }}>
        <Tag label={`Compétence : ${error ? SKILL_LABELS[error.skill] : SKILL_LABELS[profile.skill]}`} />
        <Tag label={`Erreur : ${error ? ERROR_TYPE_LABELS[error.error_type] : ERROR_TYPE_LABELS[profile.errorType]}`} />
        <Tag label={error ? `Étape : ${RECOVERY_LADDER[step]}` : "Plan à programmer"} accent={Boolean(error)} />
      </div>

      {error?.my_reasoning && <p style={{ marginTop: 13, color: "var(--muted)", fontSize: 11, lineHeight: 1.55 }}><strong style={{ color: "var(--text)" }}>Erreur commise :</strong> {error.my_reasoning}</p>}

      <div style={{ marginTop: 14, padding: 13, background: "var(--card2)", border: "1px solid var(--border)", borderRadius: 6 }}>
        <div style={{ color: "var(--accent-blue)", fontSize: 10, fontWeight: 800, letterSpacing: ".55px", textTransform: "uppercase" }}>Mini-exercice · rappel actif</div>
        <p style={{ marginTop: 5, color: "var(--text)", fontSize: 12, lineHeight: 1.55 }}>Sans consulter le corrigé, formule la règle ou les étapes de résolution qui permettraient de répondre à cette question.</p>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={3}
          placeholder="Mon rappel, mes étapes ou mon calcul…"
          aria-label="Brouillon de rappel actif"
          style={{ width: "100%", marginTop: 8, resize: "vertical", background: "var(--input)", border: "1px solid var(--input-border)", borderRadius: 5, padding: "9px 10px", color: "var(--text)", fontFamily: "var(--font-body)", fontSize: 12, lineHeight: 1.5 }}
        />
        {!revealed ? (
          <button className="soft-button" style={{ marginTop: 9 }} onClick={() => setRevealed(true)}>J’ai formulé ma réponse — voir la règle</button>
        ) : (
          <div style={{ marginTop: 10, padding: "9px 10px", borderLeft: "2px solid var(--accent-green)", background: "color-mix(in srgb, var(--accent-green) 7%, transparent)", color: "var(--text)", fontSize: 12, lineHeight: 1.55 }}>
            <strong>Règle / réponse attendue :</strong> {error?.correction || correction.reponse_attendue || "À compléter lors de la prochaine correction."}
          </div>
        )}
      </div>

      {error ? (
        <footer style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginTop: 13, flexWrap: "wrap" }}>
          <div style={{ color: "var(--muted)", fontSize: 10, lineHeight: 1.5 }}>
            <strong style={{ color: "var(--text)" }}>SM‑2 programmé :</strong> carte de rappel libre + mini‑QCM, à revoir le {error.next_review_date}.<br />
            Après validation : {RECOVERY_LADDER[Math.min(step + 1, RECOVERY_LADDER.length - 1)].toLowerCase()}.
          </div>
          <button className="primary-button" disabled={!revealed} onClick={() => void onAdvance(error)}>{step >= 3 ? "Marquer maîtrisé" : "Valider le rappel →"}</button>
        </footer>
      ) : (
        <footer style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginTop: 13, flexWrap: "wrap" }}>
          <span style={{ color: "var(--muted)", fontSize: 10, lineHeight: 1.5 }}>Cette ancienne copie n’avait pas encore de plan lié. Crée une carte SM‑2 maintenant, sans modifier la copie.</span>
          <button className="primary-button" disabled={saving || !revealed} onClick={() => void createPlan()}>{saving ? "Programmation…" : "Programmer la reprise"}</button>
        </footer>
      )}
    </article>
  );
}

function Tag({ label, accent = false }: { label: string; accent?: boolean }) {
  return <span style={{ padding: "4px 7px", borderRadius: 4, background: accent ? "color-mix(in srgb, var(--accent-blue) 10%, transparent)" : "var(--input)", border: "1px solid var(--input-border)", color: accent ? "var(--accent-blue)" : "var(--muted)", fontSize: 9, fontWeight: 700 }}>{label}</span>;
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return <div style={{ padding: "10px 11px", background: "var(--card2)", border: "1px solid var(--border)", borderRadius: 6 }}><strong style={{ display: "block", color, font: "700 20px var(--font-mono)" }}>{value}</strong><span style={{ display: "block", marginTop: 4, color: "var(--muted)", fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".5px" }}>{label}</span></div>;
}
