import { useEffect, useRef, useState } from "react";
import * as api from "../../lib/api";
import type { ConceptConfidence, Exercice, ExoCorrection, FlashcardRow, Qcm, QcmQuestion, Story } from "../../lib/types";
import { avgConfidence, overconfidentTitles } from "./analysis";
import { genJson } from "./llm";
import { DIFFS, bumpDiff, prompts, type Diff } from "./prompts";
import "./tutor.css";

import { InputPhase, type StartConfig } from "./phases/InputPhase";
import { DecouvertePhase } from "./phases/DecouvertePhase";
import { FlashcardsPhase } from "./phases/FlashcardsPhase";
import { QCMPhase } from "./phases/QCMPhase";
import { SocratPhase } from "./phases/SocratPhase";
import { ExoPhase } from "./phases/ExoPhase";
import { BilanPhase, type ScheduleResult } from "./phases/BilanPhase";
import { Transition, type TransitionSpec } from "./phases/Transition";
import { TutorError, TutorSpin } from "./shared";

type Phase = "checking" | "input" | "loading" | "decouverte" | "transition" | "flashcards" | "qcm" | "socratique" | "exercice" | "bilan";

const STAGE_ICONS: { id: Phase; icon: string; label: string }[] = [
  { id: "decouverte", icon: "🧠", label: "Découverte" },
  { id: "flashcards", icon: "🃏", label: "Mémorisation" },
  { id: "qcm", icon: "✍️", label: "Vérification" },
  { id: "socratique", icon: "🏛️", label: "Approfondissement" },
  { id: "exercice", icon: "📝", label: "Application" },
  { id: "bilan", icon: "🏆", label: "Bilan" },
];

function storyDigest(story: Story): string {
  return (
    `${story.titre}\n${story.scenario}\n\n` +
    story.etapes.map((e) => `${e.titre_court} — ${e.notion}: ${e.explication}`).join("\n")
  );
}

export function TutorModal({
  chapterId,
  ueCode,
  chapterName,
  onClose,
  onCompleted,
}: {
  chapterId: number;
  ueCode: string;
  chapterName: string;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [progressHint, setProgressHint] = useState("");
  const [streak, setStreak] = useState(0);
  const [burst, setBurst] = useState<{ emoji: string; key: number } | null>(null);
  const burstKey = useRef(0);

  const [tutorSessionId, setTutorSessionId] = useState<number | null>(null);
  const [reusableStory, setReusableStory] = useState<Story | null>(null);
  const [existingFlashcards, setExistingFlashcards] = useState<FlashcardRow[]>([]);
  const [story, setStory] = useState<Story | null>(null);
  const [adhd, setAdhd] = useState(false);
  const [diff, setDiff] = useState<Diff>(DIFFS[0]);
  const [effDiff, setEffDiff] = useState<Diff | null>(null);
  const [flashcards, setFlashcards] = useState<FlashcardRow[]>([]);
  const [confidences, setConfidences] = useState<ConceptConfidence[]>([]);
  const [flashStats, setFlashStats] = useState({ fails: 0, total: 0 });
  const [qcm, setQcm] = useState<Qcm | null>(null);
  const [qcmAdapted, setQcmAdapted] = useState(false);
  const [qcmResult, setQcmResult] = useState<{ score: number; total: number; missed: QcmQuestion[] } | null>(null);
  const [socratiqueTranscript, setSocratiqueTranscript] = useState<{ role: string; content: string }[]>([]);
  const [exoResult, setExoResult] = useState<{ got: number; total: number } | null>(null);
  const [schedule, setSchedule] = useState<ScheduleResult | null>(null);
  const [transitionSpec, setTransitionSpec] = useState<TransitionSpec | null>(null);
  const [transitionNext, setTransitionNext] = useState<Phase | null>(null);

  const contentRef = useRef<unknown>(null); // fresh upload content, only set on a non-reused start
  const exerciceRef = useRef<{ exercice: Exercice; correction: ExoCorrection | null } | null>(null);

  const celebrate = (emoji: string) => {
    setStreak((s) => s + 1);
    burstKey.current += 1;
    setBurst({ emoji, key: burstKey.current });
    setTimeout(() => setBurst((b) => (b?.key === burstKey.current ? null : b)), 900);
  };
  const breakStreak = () => setStreak(0);

  // ─── Initial check: is there a story/flashcard set to reuse for this chapter? ───
  useEffect(() => {
    (async () => {
      try {
        const [flashcardsRes, lastCompleted] = await Promise.all([
          api.listFlashcards(chapterId),
          api.getLatestCompletedSession(chapterId),
        ]);
        setExistingFlashcards(flashcardsRes);
        if (lastCompleted?.story_json) {
          setReusableStory(JSON.parse(lastCompleted.story_json));
        }
      } catch (e: any) {
        setError(e?.message ?? String(e));
      }
      setPhase("input");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId]);

  const goToTransition = (spec: TransitionSpec, next: Phase) => {
    setTransitionSpec(spec);
    setTransitionNext(next);
    setPhase("transition");
  };

  const handleStart = async (cfg: StartConfig) => {
    setDiff(cfg.diff);
    setAdhd(cfg.adhd);
    setError(null);
    setPhase("loading");

    const sourceType: "paste" | "pdf" | "image" | null = cfg.fileContent ? cfg.fileContent.type === "document" ? "pdf" : "image" : cfg.text ? "paste" : null;

    try {
      const session = await api.startOrResumeTutorSession(chapterId, sourceType, cfg.adhd);
      setTutorSessionId(session.id);

      let storyData: Story;
      if (cfg.reuseStory && reusableStory) {
        storyData = reusableStory;
        contentRef.current = storyDigest(storyData);
      } else {
        const content: unknown = cfg.fileContent ? [cfg.fileContent, { type: "text", text: cfg.text.trim() || "Analyse le document." }] : cfg.text;
        contentRef.current = content;
        storyData = await genJson<Story>(prompts.story(ueCode), content, 8192);
      }
      setStory(storyData);
      await api.saveTutorSessionProgress(session.id, { story_json: JSON.stringify(storyData) });
      setPhase("decouverte");

      if (existingFlashcards.length > 0) {
        setFlashcards(existingFlashcards);
      } else if (contentRef.current) {
        genJson<{ cards: { recto: string; verso: string; theme: string; etape: number }[] }>(prompts.flash(ueCode, storyData), contentRef.current)
          .then((f) => api.saveFlashcards(chapterId, session.id, f.cards.map((c) => ({ concept_id: String(c.etape ?? ""), question: c.recto, answer: c.verso }))))
          .then(setFlashcards)
          .catch((e) => setError("Flashcards : " + (e?.message ?? e)));
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setPhase("input");
    }
  };

  const onDecouverteDone = async (confs: ConceptConfidence[]) => {
    setConfidences(confs);
    if (tutorSessionId) {
      await api.saveTutorSessionProgress(tutorSessionId, { confidence_json: JSON.stringify(confs) });
    }
    const weak = confs.filter((c) => c.val === 1).length;
    const mid = confs.filter((c) => c.val === 2).length;
    const strong = confs.filter((c) => c.val === 3).length;
    goToTransition(
      {
        icon: "🃏",
        title: "Direction : Mémorisation",
        lines: [
          { icon: "📖", text: `Tu as travaillé ${confs.length} concepts avec ${story?.personnage || "le personnage"}.` },
          { icon: "💪", text: `${strong} maîtrisé${strong > 1 ? "s" : ""}, ${mid} compris, ${weak} incertain${weak > 1 ? "s" : ""}.` },
          { icon: "🎯", text: weak > 0 ? "Les flashcards des concepts incertains arriveront en premier." : "Les flashcards vont ancrer tout ça en mémoire." },
        ],
        cta: "Lancer les flashcards",
      },
      "flashcards",
    );
  };

  const onFlashDone = async (fails: number, total: number) => {
    setFlashStats({ fails, total });
    const failRate = total > 0 ? fails / total : 0;
    const adapted = failRate < 0.15 && diff !== DIFFS[DIFFS.length - 1];
    const nextDiff = adapted ? bumpDiff(diff) : diff;
    setEffDiff(nextDiff);
    setQcmAdapted(adapted);
    goToTransition(
      {
        icon: "✍️",
        title: "Direction : Vérification",
        lines: [
          { icon: "🃏", text: `${total} flashcards maîtrisées, ${fails} passage${fails > 1 ? "s" : ""} en révision.` },
          { icon: adapted ? "⬆" : "🎯", text: adapted ? `Excellente mémorisation — le QCM passe en difficulté "${nextDiff}".` : `Le QCM (${nextDiff}) va vérifier ta compréhension.` },
          ...(adhd ? [{ icon: "1️⃣", text: "Une question à la fois, feedback immédiat après chaque réponse." }] : []),
        ],
        cta: "Lancer le QCM",
        loading: true,
        loadingText: "Génération du QCM adapté…",
      },
      "qcm",
    );

    try {
      const q = await genJson<Qcm>(prompts.qcm(ueCode, nextDiff, story), contentRef.current ?? (story ? storyDigest(story) : ""));
      setQcm(q);
      setTransitionSpec((t) => (t ? { ...t, loading: false } : t));
    } catch (e: any) {
      setError("QCM : " + (e?.message ?? e));
      setTransitionSpec((t) => (t ? { ...t, loading: false } : t));
    }
  };

  const onQcmDone = async (score: number, total: number, missed: QcmQuestion[]) => {
    setQcmResult({ score, total, missed });
    if (tutorSessionId) {
      await api.saveTutorSessionProgress(tutorSessionId, {
        qcm_json: JSON.stringify(qcm),
        qcm_results_json: JSON.stringify(missed),
        qcm_score: score,
        qcm_total: total,
      });
    }
    const weakConcepts = confidences.filter((c) => c.val === 1).map((c) => c.titre);
    const missedThemes = [...new Set(missed.map((q) => q.theme || "").filter(Boolean))];
    const targets = [...new Set([...missedThemes, ...weakConcepts])];
    goToTransition(
      {
        icon: "🏛️",
        title: "Direction : Approfondissement",
        lines: [
          { icon: "✍️", text: `Score QCM : ${score}/${total}.` },
          { icon: "🎯", text: targets.length ? `Le dialogue socratique va cibler : ${targets.slice(0, 4).join(", ")}${targets.length > 4 ? "…" : ""}.` : "Score parfait — le dialogue va pousser plus loin." },
          ...(adhd ? [{ icon: "⚡", text: "2 échanges suffisent — court et intense." }] : []),
        ],
        cta: "Lancer le dialogue",
      },
      "socratique",
    );
  };

  const weakLabel = (() => {
    const weakConcepts = confidences.filter((c) => c.val === 1).map((c) => c.titre);
    const missedThemes = qcmResult?.missed.map((q) => q.theme || "").filter(Boolean) ?? [];
    const all = [...new Set([...missedThemes, ...weakConcepts])];
    return all.length ? all.slice(0, 3).join(", ") + (all.length > 3 ? "…" : "") : null;
  })();

  const socSys = story ? prompts.socrate(ueCode, contentRef.current ? String(contentRef.current).slice(0, 3000) : storyDigest(story).slice(0, 3000), weakLabel) : "";
  const exoSys = story ? prompts.exo(ueCode, effDiff || diff, story) + `\nContenu du cours:\n${contentRef.current ? String(contentRef.current).slice(0, 3000) : storyDigest(story).slice(0, 3000)}` : "";

  const onSocDone = async () => {
    if (tutorSessionId) {
      await api.saveTutorSessionProgress(tutorSessionId, { socratique_transcript_json: JSON.stringify(socratiqueTranscript) });
    }
    goToTransition(
      {
        icon: "📝",
        title: "Direction : Application",
        lines: [
          { icon: "🏢", text: story?.entreprise ? `Retour chez ${story.entreprise.split(",")[0]} — la situation a évolué.` : "Un cas pratique type annales t'attend." },
          { icon: "✍️", text: adhd ? "Un dossier à la fois. Rédige ce que tu peux, même partiel — tout compte." : "Rédige tes réponses comme à l'examen, le tuteur corrigera chaque question." },
        ],
        cta: "Découvrir le sujet",
      },
      "exercice",
    );
  };

  const onExoDone = async (got: number, total: number) => {
    setExoResult({ got, total });
    if (tutorSessionId && exerciceRef.current) {
      await api.saveTutorSessionProgress(tutorSessionId, { exercice_json: JSON.stringify(exerciceRef.current) });
    }
    setPhase("bilan");

    if (tutorSessionId) {
      const missedThemes = [...new Set((qcmResult?.missed ?? []).map((q) => q.theme || "Général"))];
      const overconfidenceCount = overconfidentTitles(confidences, missedThemes).length;
      try {
        const result = await api.completeTutorSession(tutorSessionId, avgConfidence(confidences), overconfidenceCount);
        setSchedule({ boxLevel: result.box_level, outcome: result.outcome, nextReviewDate: result.next_review_date });
      } catch (e: any) {
        setError("Impossible de mettre à jour l'agenda : " + (e?.message ?? e));
      }
    }
  };

  const handleClose = async () => {
    if (tutorSessionId && phase !== "bilan") {
      try {
        await api.abandonTutorSession(tutorSessionId);
      } catch {
        /* best-effort — closing shouldn't be blocked by this */
      }
    }
    onClose();
  };

  const handleFinish = () => {
    onCompleted();
    onClose();
  };

  const currentStageIdx = STAGE_ICONS.findIndex((s) => s.id === phase);
  const inSession = !["checking", "input", "loading", "bilan"].includes(phase);

  return (
    <div className={`tutor-modal${adhd ? " tutor-nofx" : ""}`}>
      {burst && (
        <div key={burst.key} style={{ position: "fixed", top: 80, left: "50%", fontSize: 30, pointerEvents: "none", zIndex: 500, animation: "burst .9s ease forwards" }}>
          {burst.emoji}
        </div>
      )}
      <button className="tutor-close-fab" onClick={handleClose} aria-label="Fermer">✕</button>

      <div className="tutor-body">
        <div style={{ textAlign: "center", marginBottom: 10, marginTop: 6 }}>
          <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 700, letterSpacing: 1 }}>{chapterName.toUpperCase()}</span>
        </div>

        {inSession && !paused && (
          <div className="tutor-prg-track">
            {STAGE_ICONS.map((s, i) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {i > 0 && <div className={`tutor-prg-line${i <= currentStageIdx ? " done" : ""}`} />}
                <div className={`tutor-prg-dot${i < currentStageIdx ? " done" : i === currentStageIdx ? " active" : ""}`} title={s.label}>
                  {i < currentStageIdx ? "✓" : s.icon}
                </div>
              </div>
            ))}
          </div>
        )}
        {inSession && !paused && progressHint && (
          <div style={{ textAlign: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 10, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>{progressHint}</span>
            {streak >= 2 && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: "var(--t-acc)" }}>🔥 {streak}</span>}
          </div>
        )}

        {phase === "checking" && <TutorSpin text="Chargement…" />}

        {phase === "input" && <InputPhase chapterName={chapterName} reusableStory={reusableStory} onStart={handleStart} />}

        {phase === "loading" && (
          <div className="tutor-card" style={{ textAlign: "center", padding: 40 }}>
            <TutorSpin text="Construction de ton histoire d'apprentissage…" />
            <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>Le reste du parcours se prépare en arrière-plan pendant que tu découvres</p>
          </div>
        )}

        {error && (
          <div className="tutor-card" style={{ marginBottom: 14 }}>
            <TutorError message={error} />
            <button className="tutor-bo" onClick={() => setError(null)} style={{ width: "100%", marginTop: 8 }}>
              OK
            </button>
          </div>
        )}

        {paused ? (
          <div className="tutor-card" style={{ textAlign: "center", padding: 32 }}>
            <div style={{ fontSize: 44, marginBottom: 10 }}>⏸</div>
            <h3 style={{ fontFamily: "var(--font-story)", fontSize: 18, color: "var(--t-pri)", marginBottom: 10 }}>Session en pause</h3>
            <div className="tutor-trans-recap" style={{ textAlign: "center" }}>
              <strong style={{ color: "var(--t-pri)" }}>Où tu en étais :</strong>
              <br />
              {progressHint || "Ta progression est gelée, rien n'est perdu."}
            </div>
            <button className="tutor-bp" onClick={() => setPaused(false)} style={{ width: "100%" }}>
              ▶ Reprendre
            </button>
          </div>
        ) : (
          <>
            {phase === "transition" && transitionSpec && transitionNext && (
              <Transition
                spec={transitionSpec}
                adhd={adhd}
                onContinue={() => {
                  setPhase(transitionNext);
                  setTransitionSpec(null);
                  setTransitionNext(null);
                }}
              />
            )}

            {phase === "decouverte" && story && (
              <DecouvertePhase story={story} ueCode={ueCode} adhd={adhd} onDone={onDecouverteDone} onHint={setProgressHint} celebrate={celebrate} />
            )}

            {phase === "flashcards" && (
              <FlashcardsPhase cards={flashcards} confidences={confidences} adhd={adhd} onDone={onFlashDone} onHint={setProgressHint} celebrate={celebrate} breakStreak={breakStreak} />
            )}

            {phase === "qcm" && (
              <QCMPhase qcm={qcm} difficulty={effDiff || diff} adapted={qcmAdapted} adhd={adhd} onNext={onQcmDone} onHint={setProgressHint} celebrate={celebrate} breakStreak={breakStreak} />
            )}

            {phase === "socratique" && (
              <SocratPhase sys={socSys} weakLabel={weakLabel} adhd={adhd} onNext={onSocDone} onHint={setProgressHint} onTranscript={setSocratiqueTranscript} />
            )}

            {phase === "exercice" && (
              <ExoPhase
                sys={exoSys}
                ue={ueCode}
                adhd={adhd}
                onHint={setProgressHint}
                celebrate={celebrate}
                onExercice={(exercice, correction) => {
                  exerciceRef.current = { exercice, correction };
                }}
                onNext={onExoDone}
              />
            )}

            {phase === "bilan" && story && (
              <BilanPhase
                data={{
                  storyTitle: story.titre,
                  personnage: story.personnage,
                  flashTotal: flashStats.total,
                  flashFails: flashStats.fails,
                  qcmScore: qcmResult?.score ?? 0,
                  qcmTotal: qcmResult?.total ?? 10,
                  missed: qcmResult?.missed ?? [],
                  difficulty: effDiff || diff,
                  adapted: qcmAdapted,
                  confidences,
                  exoScore: exoResult?.got ?? 0,
                  exoTotal: exoResult?.total ?? 0,
                  adhd,
                }}
                schedule={schedule}
                onFinish={handleFinish}
              />
            )}
          </>
        )}
      </div>

      {inSession && !paused && phase !== "transition" && (
        <button className="tutor-pause-fab" onClick={() => setPaused(true)}>
          ⏸ Pause
        </button>
      )}
    </div>
  );
}
