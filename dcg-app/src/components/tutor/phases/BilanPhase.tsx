import type { ConceptConfidence, QcmQuestion } from "../../../lib/types";
import { overconfidentTitles } from "../analysis";
import { TutorSpin } from "../shared";

export interface BilanData {
  storyTitle: string;
  personnage: string;
  flashTotal: number;
  flashFails: number;
  qcmScore: number;
  qcmTotal: number;
  missed: QcmQuestion[];
  difficulty: string;
  adapted: boolean;
  confidences: ConceptConfidence[];
  exoScore: number;
  exoTotal: number;
  adhd: boolean;
}

export interface ScheduleResult {
  boxLevel: number;
  outcome: "strong" | "ok" | "weak";
  nextReviewDate: string;
}

const OUTCOME_COPY: Record<ScheduleResult["outcome"], { label: string; color: string }> = {
  strong: { label: "Solide — l'intervalle avant la prochaine révision s'allonge", color: "var(--t-ok)" },
  ok: { label: "Correct — même intervalle pour la prochaine révision", color: "var(--t-acc)" },
  weak: { label: "Fragile — la prochaine révision arrive plus vite", color: "var(--t-err)" },
};

export function BilanPhase({ data, schedule, onFinish }: { data: BilanData; schedule: ScheduleResult | null; onFinish: () => void }) {
  const { storyTitle, flashTotal, flashFails, qcmScore, qcmTotal, missed, difficulty, adapted, confidences, exoScore, exoTotal, adhd } = data;
  const pct = qcmTotal > 0 ? Math.round((qcmScore / qcmTotal) * 100) : 0;
  const level = pct >= 80 ? "Excellente" : pct >= 60 ? "Bonne" : pct >= 40 ? "En progression" : "À consolider";
  const lc = pct >= 80 ? "var(--t-ok)" : pct >= 60 ? "var(--t-acc)" : "var(--t-err)";

  const weakConcepts = confidences.filter((c) => c.val === 1).map((c) => c.titre);
  const midConcepts = confidences.filter((c) => c.val === 2).map((c) => c.titre);
  const missedThemes = [...new Set(missed.map((q) => q.theme || "Général"))];
  const toReview = [...new Set([...weakConcepts, ...missedThemes])];

  const overconfident = overconfidentTitles(confidences, missedThemes);

  return (
    <div className="tutor-card" style={{ textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 8 }}>{pct >= 80 ? "🏆" : pct >= 60 ? "📚" : "💪"}</div>
      <h2 style={{ fontFamily: "var(--font-story)", fontSize: 20, color: "var(--t-pri)", marginBottom: 4 }}>Bilan de maîtrise</h2>
      <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 20 }}>{storyTitle}</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 10, marginBottom: 20 }}>
        {[
          { v: flashFails === 0 ? "✓" : `${flashFails}✗`, l: `Flashcards (${flashTotal})`, c: flashFails <= 2 ? "var(--t-ok)" : "var(--t-acc)" },
          { v: `${qcmScore}/${qcmTotal}`, l: `QCM${adapted ? " ⬆" : ""} (${difficulty})`, c: pct >= 80 ? "var(--t-ok)" : pct >= 60 ? "var(--t-acc)" : "var(--t-err)" },
          ...(exoTotal ? [{ v: `${exoScore}/${exoTotal}`, l: "Cas pratique", c: exoScore / exoTotal >= 0.6 ? "var(--t-ok)" : exoScore / exoTotal >= 0.4 ? "var(--t-acc)" : "var(--t-err)" }] : []),
          { v: `${pct}%`, l: "Maîtrise", c: lc },
        ].map((s, i) => (
          <div key={i} style={{ background: "var(--card2)", padding: 14, borderRadius: 10, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.c, fontFamily: "var(--font-mono)" }}>{s.v}</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{s.l}</div>
          </div>
        ))}
      </div>

      <div style={{ padding: 14, borderRadius: 10, borderLeft: `3px solid ${lc}`, textAlign: "left", marginBottom: 14, background: "var(--card2)" }}>
        <strong style={{ color: lc, fontSize: 14 }}>{level} maîtrise</strong>
        <p style={{ margin: "4px 0 0", fontSize: 13, lineHeight: 1.6 }}>
          {pct >= 80
            ? `Tu maîtrises ce chapitre. Tes prédictions, tes reformulations et le cas pratique confirment ta compréhension.`
            : pct >= 60
            ? "Bonne base acquise. Le plan ci-dessous cible précisément ce qui reste à consolider."
            : "Ce chapitre nécessite encore du travail — mais tu sais maintenant exactement où porter l'effort."}
        </p>
      </div>

      {overconfident.length > 0 && (
        <div style={{ padding: 12, borderRadius: 10, borderLeft: "3px solid var(--t-err)", textAlign: "left", marginBottom: 14, background: "var(--t-erb)" }}>
          <strong style={{ color: "var(--t-err)", fontSize: 13 }}>⚠️ Attention à la surconfiance</strong>
          <p style={{ margin: "4px 0 0", fontSize: 12, lineHeight: 1.6 }}>
            Tu te sentais 💪 sur {overconfident.join(", ")} mais le QCM montre des erreurs sur ce{overconfident.length > 1 ? "s" : ""} thème
            {overconfident.length > 1 ? "s" : ""}. C'est précieux à savoir : revois-le{overconfident.length > 1 ? "s" : ""} en priorité.
          </p>
        </div>
      )}

      <div style={{ textAlign: "left", marginBottom: 16, background: "var(--t-prl)", borderRadius: 10, padding: 14, borderLeft: "3px solid var(--t-pri)" }}>
        <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--t-pri)", marginBottom: 10 }}>📋 Ton plan de révision</h4>
        <div style={{ fontSize: 13, lineHeight: 1.8 }}>
          {toReview.length > 0 ? (
            <div style={{ marginBottom: 6 }}>
              <strong>À revoir en priorité :</strong>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 4 }}>
                {toReview.map((t) => (
                  <span key={t} style={{ background: "var(--t-erb)", color: "var(--t-err)", fontSize: 11, padding: "2px 9px", borderRadius: 100, fontWeight: 600 }}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ marginBottom: 6 }}>Aucun point faible critique identifié 🎉</div>
          )}
          {midConcepts.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <strong>À consolider :</strong>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 4 }}>
                {midConcepts.map((t) => (
                  <span key={t} style={{ background: "var(--t-acl)", color: "var(--t-acc)", fontSize: 11, padding: "2px 9px", borderRadius: 100, fontWeight: 600 }}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
          {schedule ? (
            <div>
              <strong>Prochaine session :</strong> ce chapitre repasse en <strong style={{ color: OUTCOME_COPY[schedule.outcome].color }}>boîte {schedule.boxLevel}</strong>, prévue le{" "}
              <strong style={{ color: "var(--t-pri)" }}>{schedule.nextReviewDate}</strong>.
              <div style={{ fontSize: 12, color: OUTCOME_COPY[schedule.outcome].color, marginTop: 4 }}>{OUTCOME_COPY[schedule.outcome].label}</div>
            </div>
          ) : (
            <TutorSpin text="Mise à jour de l'agenda de révision…" />
          )}
        </div>
      </div>

      {adhd && (
        <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12, lineHeight: 1.5 }}>
          Tu es allé au bout d'une session complète. Avec un TDAH, c'est loin d'être rien — sérieusement, bravo. 👏
        </p>
      )}

      <button className="tutor-bp" disabled={!schedule} onClick={onFinish} style={{ width: "100%", fontSize: 15, padding: "13px 24px" }}>
        Retour au planning →
      </button>
    </div>
  );
}
