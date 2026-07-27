import { useEffect, useState } from "react";
import type { ConceptConfidence, Story } from "../../../lib/types";
import { ACT_TYPES, RECALL_EVERY, prompts } from "../prompts";
import { genText, CHEAP_MODEL } from "../llm";
import { Consigne, TutorSpin } from "../shared";

type Sub = "context" | "feedback" | "reveal" | "reform_ack" | "confidence" | "recall" | "recall_done" | "epilogue";

export function DecouvertePhase({
  story,
  ueCode,
  model,
  adhd,
  offline,
  onDone,
  onHint,
  celebrate,
}: {
  story: Story;
  ueCode: string;
  model: string;
  adhd: boolean;
  /** Imported-lesson session: no live feedback calls — per-hypothesis
   * feedback ships in the story (`feedbacks`), everything else is
   * deterministic local text. */
  offline: boolean;
  onDone: (confidences: ConceptConfidence[]) => void;
  onHint: (hint: string) => void;
  celebrate: (emoji: string) => void;
}) {
  const etapes = story.etapes || [];
  const total = etapes.length;
  const [step, setStep] = useState(-1);
  const [sub, setSub] = useState<Sub>("context");
  const [answer, setAnswer] = useState("");
  const [inputMode, setInputMode] = useState<"choix" | "texte">(adhd ? "choix" : "texte");
  const [feedbackText, setFeedbackText] = useState("");
  const [reformText, setReformText] = useState("");
  const [reformAck, setReformAck] = useState("");
  const [confidence, setConfidence] = useState<1 | 2 | 3 | null>(null);
  const [confidences, setConfidences] = useState<ConceptConfidence[]>([]);
  const [recallAns, setRecallAns] = useState("");
  const [recallFb, setRecallFb] = useState("");
  const [loading, setLoading] = useState(false);

  const e = etapes[step] || null;
  const actType = e?.type_activite && ACT_TYPES[e.type_activite] ? e.type_activite : "prediction";
  const act = ACT_TYPES[actType];

  useEffect(() => {
    if (step >= 0 && e) onHint(`Découverte — concept ${step + 1}/${total} : "${e.titre_court}"`);
    else if (step === -1) onHint("Découverte — introduction de l'histoire");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, total]);

  if (!etapes.length) return null;

  const reset = () => {
    setAnswer("");
    setFeedbackText("");
    setReformText("");
    setReformAck("");
    setConfidence(null);
    setRecallAns("");
    setRecallFb("");
  };

  const submitAnswer = async (txt?: string) => {
    const a = (txt ?? answer).trim();
    if (!a || !e) return;
    setAnswer(a);

    if (offline) {
      celebrate("");
      // Pre-written feedback exists for hypothesis picks; a typed answer has
      // nothing to judge it offline, so jump straight to the full concept.
      const hypIdx = (e.hypotheses ?? []).findIndex((h) => h === a);
      const canned = hypIdx >= 0 ? e.feedbacks?.[hypIdx] : undefined;
      if (canned) {
        setFeedbackText(canned);
        setSub("feedback");
      } else {
        setSub("reveal");
      }
      return;
    }

    setLoading(true);
    setSub("feedback");
    try {
      const r = await genText(prompts.feedback(ueCode, actType, e.notion, e.explication), a, 600, model);
      setFeedbackText(r);
      celebrate("");
    } catch {
      setFeedbackText("Voyons le concept ensemble.");
    }
    setLoading(false);
  };

  const submitReform = async () => {
    if (!reformText.trim() || !e) return;

    if (offline) {
      celebrate("");
      setReformAck(`Bien ! Compare ta formulation avec la clé : « ${e.a_retenir} » — si l'idée principale y est, c'est acquis.`);
      setSub("reform_ack");
      return;
    }

    setLoading(true);
    setSub("reform_ack");
    try {
      const r = await genText(
        prompts.reformAck(ueCode),
        `Le concept est : "${e.notion}" — ${e.a_retenir}\n\nMa reformulation : ${reformText.trim()}`,
        300,
        CHEAP_MODEL,
      );
      setReformAck(r);
      celebrate("");
    } catch {
      setReformAck("Bonne reformulation, continue !");
    }
    setLoading(false);
  };

  const submitRecall = async () => {
    if (!recallAns.trim()) return;
    const recallE = etapes[Math.max(0, step - RECALL_EVERY)];

    if (offline) {
      celebrate("");
      setRecallFb(`Compare avec la clé : ${recallE.a_retenir}`);
      setSub("recall_done");
      return;
    }

    setLoading(true);
    try {
      const r = await genText(prompts.recallCheck(ueCode, recallE.notion, recallE.a_retenir), recallAns.trim(), 300, CHEAP_MODEL);
      setRecallFb(r);
      celebrate("");
    } catch {
      setRecallFb("Bonne tentative ! La clé : " + recallE.a_retenir);
    }
    setSub("recall_done");
    setLoading(false);
  };

  const goNext = () => {
    if (step >= total - 1) {
      setSub("epilogue");
      return;
    }
    const n = step + 1;
    reset();
    setStep(n);
    setSub(n > 0 && n % RECALL_EVERY === 0 ? "recall" : "context");
  };

  const handleConfidence = (v: 1 | 2 | 3) => {
    setConfidence(v);
    setConfidences((p) => [...p, { step, val: v, titre: e!.titre_court, notion: e!.notion }]);
    if (v === 3) celebrate("");
  };

  const progressPct = step < 0 ? 0 : Math.min(100, ((step + 1) / total) * 100);
  const restants = total - (step + 1);

  return (
    <div className="tutor-card">
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
        <div style={{ flex: 1, background: "var(--track)", borderRadius: 2, height: 4, overflow: "hidden" }}>
          <div className="pfill" style={{ width: `${progressPct}%`, height: "100%", background: "var(--t-pri)" }} />
        </div>
        <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--font-mono)", flexShrink: 0 }}>
          {step < 0 ? "Intro" : sub === "epilogue" ? "Fin" : adhd ? `reste ${restants} concept${restants > 1 ? "s" : ""}` : `${step + 1}/${total}`}
        </span>
      </div>

      {step === -1 && (
        <div>
          <h2 style={{ fontFamily: "var(--font-story)", fontSize: 19, color: "var(--t-pri)", marginBottom: 14 }}>{story.titre}</h2>
          <div className="tutor-story-ctx">{story.scenario}</div>
          <p style={{ fontSize: 13, color: "var(--muted)", textAlign: "center", margin: "0 0 6px" }}>
            L'histoire de <strong style={{ color: "var(--text)" }}>{story.personnage}</strong>
            {story.entreprise ? (
              <>
                {" "}
                · <span style={{ fontStyle: "italic" }}>{story.entreprise}</span>
              </>
            ) : null}
          </p>
          <div style={{ background: "var(--t-prl)", borderRadius: 2, padding: 14, margin: "12px 0", fontSize: 13, lineHeight: 1.6 }}>
            <strong style={{ color: "var(--t-pri)" }}>Découverte active</strong>
            <br />À chaque étape, une activité différente : prédire, relier, imaginer l'inverse.
            {adhd ? " Un concept = ~2 min. Tu avances à ton rythme." : ""}
          </div>
          <button
            className="tutor-bp"
            style={{ width: "100%" }}
            onClick={() => {
              setStep(0);
              setSub("context");
            }}
          >
            {adhd ? "Le 1er concept (2 min) →" : "Commencer →"}
          </button>
        </div>
      )}

      {step >= 0 && sub === "recall" && (
        <div>
          <Consigne text="Réponds de mémoire, puis vérifie — même approximatif, ça compte" />
          <div className="tutor-recall-box">
            <h4 style={{ margin: "0 0 10px", color: "var(--t-ok)", fontSize: 14 }}>Micro-rappel</h4>
            <p style={{ fontSize: 13, margin: "0 0 12px", lineHeight: 1.6 }}>
              {etapes[Math.max(0, step - RECALL_EVERY)]?.question_rappel || "Que retiens-tu du concept précédent ?"}
            </p>
            <textarea
              className="tutor-tf"
              value={recallAns}
              onChange={(ev) => setRecallAns(ev.target.value)}
              placeholder="Ce dont je me souviens… (une phrase suffit)"
              rows={2}
              style={{ marginBottom: 8 }}
            />
            <button className="tutor-bp" disabled={!recallAns.trim() || loading} onClick={submitRecall} style={{ width: "100%" }}>
              {loading ? "…" : "Vérifier"}
            </button>
          </div>
        </div>
      )}

      {step >= 0 && sub === "recall_done" && (
        <div>
          <div className="tutor-recall-box">
            <div className="tutor-feedback-box tutor-fb-good" style={{ textAlign: "left" }}>
              {recallFb}
            </div>
            <button
              className="tutor-bp"
              style={{ width: "100%", marginTop: 8 }}
              onClick={() => {
                reset();
                setSub("context");
              }}
            >
              Continuer l'histoire →
            </button>
          </div>
        </div>
      )}

      {step >= 0 && e && sub === "context" && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ background: "var(--t-pri)", color: "#fff", fontSize: 12, padding: "3px 10px", borderRadius: 2, fontFamily: "var(--font-mono)" }}>{step + 1}</span>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--t-pri)" }}>{e.titre_court}</h3>
          </div>
          <Consigne text={inputMode === "choix" ? "Lis l'histoire, puis touche l'hypothèse qui te semble juste" : "Lis l'histoire, puis écris ta réponse — pas besoin d'être parfait"} />
          <div className="tutor-story-ctx">"{e.contexte_narratif}"</div>
          <div className="tutor-think-box">
            <div className="tutor-think-label">{act.label}</div>
            <p style={{ fontSize: 14, color: "var(--t-pri)", margin: "0 0 10px", lineHeight: 1.6, fontWeight: 500 }}>{e.question_activite}</p>
            <div className="tutor-mode-toggle">
              <button className={inputMode === "choix" ? "on" : ""} onClick={() => setInputMode("choix")}>Je choisis</button>
              <button className={inputMode === "texte" ? "on" : ""} onClick={() => setInputMode("texte")}>J'écris</button>
            </div>
            {inputMode === "choix" && e.hypotheses?.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {e.hypotheses.map((h, i) => (
                  <button key={i} className="tutor-hyp-btn" disabled={loading} onClick={() => submitAnswer(h)}>
                    {h}
                  </button>
                ))}
              </div>
            ) : (
              <>
                <textarea className="tutor-tf" value={answer} onChange={(ev) => setAnswer(ev.target.value)} placeholder={act.hint + " (une phrase suffit)"} rows={3} />
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button className="tutor-bp" disabled={!answer.trim() || loading} onClick={() => submitAnswer()} style={{ flex: 2 }}>
                    Soumettre
                  </button>
                  <button
                    className="tutor-bs"
                    onClick={() => {
                      setFeedbackText("");
                      setSub("reveal");
                    }}
                    style={{ flex: 1, fontSize: 11, color: "var(--muted)" }}
                  >
                    Passer
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {step >= 0 && e && sub === "feedback" && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <span style={{ background: "var(--t-pri)", color: "#fff", fontSize: 12, padding: "3px 10px", borderRadius: 2, fontFamily: "var(--font-mono)" }}>{step + 1}</span>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--t-pri)" }}>{e.titre_court}</h3>
          </div>
          <div style={{ background: "var(--card2)", padding: 10, borderRadius: 2, fontSize: 13, color: "var(--muted)", marginBottom: 10, fontStyle: "italic" }}>
            Ta réponse : "{answer}"
          </div>
          {loading ? (
            <TutorSpin text="Le tuteur regarde ta réponse…" />
          ) : (
            <div className={`tutor-feedback-box ${/bonne|exact|bien|juste|pertinent|bravo/i.test(feedbackText) ? "tutor-fb-good" : "tutor-fb-partial"}`}>{feedbackText}</div>
          )}
          {!loading && (
            <button className="tutor-bp" onClick={() => setSub("reveal")} style={{ width: "100%", marginTop: 8 }}>
              Voir le concept complet →
            </button>
          )}
        </div>
      )}

      {step >= 0 && e && sub === "reveal" && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ background: "var(--t-pri)", color: "#fff", fontSize: 12, padding: "3px 10px", borderRadius: 2, fontFamily: "var(--font-mono)" }}>{step + 1}</span>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--t-pri)" }}>{e.titre_court}</h3>
          </div>
          <Consigne text="Lis, puis reformule en une phrase — comme si tu l'expliquais à un ami" />
          <div className="tutor-reveal-box">
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--t-pri)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{e.notion}</div>
            <p style={{ fontSize: 14, lineHeight: 1.7, margin: "0 0 10px" }}>{e.explication}</p>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--muted)", padding: "8px 12px", background: "var(--t-okb)", borderRadius: 2, borderLeft: "3px solid var(--t-ok)" }}>
              <strong style={{ color: "var(--t-ok)", fontSize: 12 }}>Dans notre histoire :</strong>
              <br />
              {e.application}
            </div>
          </div>
          <div className="tutor-key-box">À retenir — {e.a_retenir}</div>
          <div className="tutor-think-box" style={{ borderColor: "var(--t-acc)" }}>
            <div className="tutor-think-label" style={{ color: "var(--t-acc)" }}>Reformule dans tes propres mots</div>
            <textarea className="tutor-tf" value={reformText} onChange={(ev) => setReformText(ev.target.value)} placeholder="Avec mes mots, ce concept c'est… (une phrase courte suffit)" rows={2} />
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="tutor-bp" disabled={!reformText.trim() || loading} onClick={submitReform} style={{ flex: 2 }}>
                Valider
              </button>
              <button className="tutor-bs" onClick={() => setSub("confidence")} style={{ flex: 1, fontSize: 11, color: "var(--muted)" }}>
                Passer
              </button>
            </div>
          </div>
        </div>
      )}

      {step >= 0 && e && sub === "reform_ack" && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <span style={{ background: "var(--t-ok)", color: "#fff", fontSize: 12, padding: "3px 10px", borderRadius: 2 }}>✓</span>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--t-pri)" }}>{e.titre_court}</h3>
          </div>
          <div style={{ background: "var(--card2)", padding: 10, borderRadius: 2, fontSize: 13, color: "var(--muted)", marginBottom: 8, fontStyle: "italic" }}>
            Ta reformulation : "{reformText}"
          </div>
          {loading ? <TutorSpin text="…" /> : <div className="tutor-feedback-box tutor-fb-good">{reformAck}</div>}
          {!loading && (
            <button className="tutor-bp" onClick={() => setSub("confidence")} style={{ width: "100%", marginTop: 8 }}>
              Continuer
            </button>
          )}
        </div>
      )}

      {step >= 0 && e && sub === "confidence" && (
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <Consigne text="Sois honnête — cette info pilote la suite de ta session" />
          <p style={{ fontSize: 14, color: "var(--t-pri)", fontWeight: 600, margin: "0 0 14px" }}>Comment te sens-tu sur "{e.titre_court}" ?</p>
          <div className="tutor-conf-bar">
            {[
              { v: 1 as const, label: "Pas sûr" },
              { v: 2 as const, label: "Je comprends" },
              { v: 3 as const, label: "Je maîtrise" },
            ].map((o) => (
              <button key={o.v} className={`tutor-conf-btn${confidence === o.v ? " sel" : ""}`} onClick={() => handleConfidence(o.v)}>
                {o.label}
              </button>
            ))}
          </div>
          {confidence && (
            <button className="tutor-bp" onClick={goNext} style={{ marginTop: 14 }}>
              {step < total - 1 ? (adhd ? `Concept suivant (reste ${total - step - 1}) →` : "Concept suivant →") : "Conclusion →"}
            </button>
          )}
        </div>
      )}

      {sub === "epilogue" && (
        <div style={{ textAlign: "center" }}>
          <h3 style={{ fontFamily: "var(--font-story)", fontSize: 17, color: "var(--t-pri)", marginBottom: 10 }}>Fin de l'histoire</h3>
          <div className="tutor-story-ctx" style={{ fontStyle: "normal", textAlign: "center", borderLeftColor: "var(--t-ok)" }}>{story.epilogue}</div>
          {confidences.length > 0 && (
            <div style={{ margin: "14px 0", fontSize: 13, color: "var(--muted)" }}>
              <p style={{ margin: "0 0 6px", fontWeight: 600, color: "var(--t-pri)" }}>Ton ressenti sur les {total} concepts :</p>
              <div style={{ display: "flex", gap: 4, justifyContent: "center", flexWrap: "wrap" }}>
                {confidences.map((c, i) => (
                  <div
                    key={i}
                    title={c.titre}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 2,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      fontFamily: "var(--font-mono)",
                      fontWeight: 700,
                      background: c.val === 3 ? "var(--t-okb)" : c.val === 2 ? "var(--t-acl)" : "var(--t-erb)",
                      color: c.val === 3 ? "var(--t-ok)" : c.val === 2 ? "var(--t-acc)" : "var(--t-err)",
                      border: `1px solid ${c.val === 3 ? "var(--t-ok)" : c.val === 2 ? "var(--t-acc)" : "var(--t-err)"}`,
                    }}
                  >
                    {c.val === 3 ? "+" : c.val === 2 ? "·" : "−"}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button
              className="tutor-bs"
              style={{ flex: 1 }}
              onClick={() => {
                reset();
                setStep(0);
                setSub("context");
                setConfidences([]);
              }}
            >
              Relire
            </button>
            <button className="tutor-bp" style={{ flex: 2 }} onClick={() => onDone(confidences)}>
              Mémorisation →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
