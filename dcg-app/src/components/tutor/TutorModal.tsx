import { useEffect, useRef, useState } from "react";
import * as api from "../../lib/api";
import type { ConceptConfidence, Exercice, ExoCorrection, FlashcardRow, Qcm, QcmQuestion, Story, TutorSessionRow } from "../../lib/types";
import { useAppState } from "../../state/AppState";
import { formatTokens } from "../../lib/format";
import { avgConfidence, buildSessionDigest, flashcardMasteryConfidence, overconfidentTitles } from "./analysis";
import { genJson, genText, setUsageListener } from "./llm";
import { composeLocalCompteRendu, type LessonFile } from "./lesson";
import { buildConfusionFlashcards } from "./confusionFlashcards";
import { DIFFS, bumpDiff, prompts, type Diff } from "./prompts";
import "./tutor.css";

import { InputPhase } from "./phases/InputPhase";
import { RevisionIntro } from "./phases/RevisionIntro";
import { DecouvertePhase } from "./phases/DecouvertePhase";
import { FlashcardsPhase } from "./phases/FlashcardsPhase";
import { QCMPhase } from "./phases/QCMPhase";
import { SocratPhase } from "./phases/SocratPhase";
import { ExoPhase } from "./phases/ExoPhase";
import { BilanPhase, type ScheduleResult } from "./phases/BilanPhase";
import { Transition, type TransitionSpec } from "./phases/Transition";
import { TutorError, TutorSpin } from "./shared";

type Phase =
  | "checking"
  | "resume-prompt"
  | "revision-intro"
  | "input"
  | "loading"
  | "decouverte"
  | "transition"
  | "flashcards"
  | "qcm"
  | "socratique"
  | "exercice"
  | "bilan";

/** How long the user can go without a break before the break nudge appears.
 * ADHD time blindness means people often don't notice an hour has passed —
 * this is a suggestion, not an enforced pause, and resets whenever the user
 * actually takes a break (nudge-triggered or the existing manual pause). */
const BREAK_NUDGE_MS = 25 * 60 * 1000;

const ALL_STAGES: { id: Phase; label: string }[] = [
  { id: "decouverte", label: "Découverte" },
  { id: "flashcards", label: "Mémorisation" },
  { id: "qcm", label: "Vérification" },
  { id: "socratique", label: "Approfondissement" },
  { id: "exercice", label: "Application" },
  { id: "bilan", label: "Bilan" },
];

function storyDigest(story: Story): string {
  return (
    `${story.titre}\n${story.scenario}\n\n` +
    story.etapes.map((e) => `${e.titre_court} — ${e.notion}: ${e.explication}`).join("\n")
  );
}

interface FinalizeCtx {
  sessionId: number;
  isRevision: boolean;
  offline: boolean;
  confidences: ConceptConfidence[];
  qcmResult: { score: number; total: number; missed: QcmQuestion[] } | null;
  exoResult: { got: number; total: number } | null;
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
  const { model } = useAppState();
  const [phase, setPhase] = useState<Phase>("checking");
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [progressHint, setProgressHint] = useState("");
  const [streak, setStreak] = useState(0);
  const [showBreakNudge, setShowBreakNudge] = useState(false);
  const lastBreakRef = useRef<number>(Date.now());
  const [notesOpen, setNotesOpen] = useState(false);
  const [scratchpad, setScratchpad] = useState("");

  const [tutorSessionId, setTutorSessionId] = useState<number | null>(null);
  const [isRevision, setIsRevision] = useState(false);
  // Offline sessions (imported "leçon Claude" file) never call the API:
  // story/flashcards/QCM come from the file, socratique/exercice are skipped,
  // and the compte-rendu is composed locally.
  const [offline, setOffline] = useState(false);
  const [reusableStory, setReusableStory] = useState<Story | null>(null);
  const [reusableQcm, setReusableQcm] = useState<Qcm | null>(null);
  const [reusableOffline, setReusableOffline] = useState(false);
  const [reusableCompteRendu, setReusableCompteRendu] = useState<string | null>(null);
  const [compteRenduText, setCompteRenduText] = useState<string | null>(null);
  const [inProgressSession, setInProgressSession] = useState<TutorSessionRow | null>(null);
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
  const [exoDraft, setExoDraft] = useState<{ exercice: Exercice; answers: Record<string, string> } | null>(null);
  const [schedule, setSchedule] = useState<ScheduleResult | null>(null);
  const [transitionSpec, setTransitionSpec] = useState<TransitionSpec | null>(null);
  const [transitionNext, setTransitionNext] = useState<Phase | null>(null);
  const [usage, setUsage] = useState({ inputTokens: 0, outputTokens: 0 });

  const contentRef = useRef<unknown>(null); // fresh upload content, only set on a non-reused start
  const exerciceRef = useRef<{ exercice: Exercice; correction: ExoCorrection | null } | null>(null);
  const usageRef = useRef({ inputTokens: 0, outputTokens: 0 }); // synchronous mirror of `usage`, for reading the latest total inside async save calls

  const inSession = !["checking", "resume-prompt", "revision-intro", "input", "loading", "bilan"].includes(phase);

  const resetBreakClock = () => {
    lastBreakRef.current = Date.now();
    setShowBreakNudge(false);
  };

  // Polls every 30s rather than a single 25-min setTimeout so it survives
  // phase changes and pause/resume without needing to be re-armed manually.
  useEffect(() => {
    if (!inSession) return;
    const id = window.setInterval(() => {
      if (!paused && Date.now() - lastBreakRef.current >= BREAK_NUDGE_MS) {
        setShowBreakNudge(true);
      }
    }, 30_000);
    return () => window.clearInterval(id);
  }, [inSession, paused]);

  // One listener per open tutor session — every genText/genJson/genChat call
  // anywhere in the tutor flow reports here (see llm.ts), so the running
  // total is accurate without each phase component needing to know usage
  // tracking exists.
  useEffect(() => {
    setUsageListener((delta) => {
      usageRef.current = {
        inputTokens: usageRef.current.inputTokens + delta.inputTokens,
        outputTokens: usageRef.current.outputTokens + delta.outputTokens,
      };
      setUsage(usageRef.current);
    });
    return () => setUsageListener(null);
  }, []);

  const celebrate = (_emoji: string) => {
    setStreak((s) => s + 1);
  };
  const breakStreak = () => setStreak(0);

  // ─── Initial check: reusable story/compte-rendu (→ short revision flow by
  // default), and — the crash-recovery path — a session left "in_progress"
  // because the app never got a chance to call abandon_tutor_session
  // (force-quit, crash, laptop killed mid-session). ───
  useEffect(() => {
    (async () => {
      try {
        const [flashcardsRes, lastCompleted, unfinished] = await Promise.all([
          api.listFlashcards(chapterId),
          api.getLatestCompletedSession(chapterId),
          api.getInProgressSession(chapterId),
        ]);
        setExistingFlashcards(flashcardsRes);
        const hasStory = !!lastCompleted?.story_json;
        if (lastCompleted?.story_json) {
          setReusableStory(JSON.parse(lastCompleted.story_json));
          setReusableOffline(lastCompleted.is_offline_lesson);
          if (lastCompleted.qcm_json) {
            try {
              setReusableQcm(JSON.parse(lastCompleted.qcm_json));
            } catch {
              /* malformed stored QCM — offline revision will surface a clear error */
            }
          }
          const validDiff = (DIFFS as readonly string[]).includes(lastCompleted.difficulty) ? (lastCompleted.difficulty as Diff) : DIFFS[0];
          setDiff(validDiff);
          if (lastCompleted.bilan_json) {
            try {
              setReusableCompteRendu(JSON.parse(lastCompleted.bilan_json).text ?? null);
            } catch {
              /* older/malformed bilan_json — just skip it, not fatal */
            }
          }
        }
        if (unfinished) {
          setInProgressSession(unfinished);
          setPhase("resume-prompt");
          return;
        }
        setPhase(hasStory ? "revision-intro" : "input");
        return;
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

  /** Shared end-of-session write-back for both flows: generates a compte-rendu
   * grounded in this session's actual results (for the *next* revision to
   * read), saves it, and completes the session (Leitner schedule update).
   * Takes its inputs as explicit params rather than reading component state,
   * since callers sometimes invoke this in the same tick as the setState
   * calls that produced those values (state wouldn't have flushed yet). */
  const finalizeSession = async (ctx: FinalizeCtx) => {
    setPhase("bilan");
    try {
      const missedThemes = [...new Set((ctx.qcmResult?.missed ?? []).map((q) => q.theme || "Général"))];
      const overconfident = overconfidentTitles(ctx.confidences, missedThemes);
      const digest = buildSessionDigest({
        confidences: ctx.confidences,
        qcmResult: ctx.qcmResult,
        exoResult: ctx.isRevision ? null : ctx.exoResult,
        overconfident,
      });

      let compteRendu: string | null = null;
      if (ctx.offline) {
        // No API in an offline session — compose the next-revision note
        // directly from the structured results instead of asking the model.
        compteRendu = composeLocalCompteRendu({ confidences: ctx.confidences, qcmResult: ctx.qcmResult, overconfident });
        setCompteRenduText(compteRendu);
      } else {
        try {
          compteRendu = await genText(prompts.compteRendu(ueCode), digest, 500, model);
          setCompteRenduText(compteRendu);
        } catch (e: any) {
          // Non-fatal: the session still completes and the schedule still
          // updates even if writing the compte-rendu itself failed.
          setError("Compte-rendu : " + (e?.message ?? e));
        }
      }

      await api.saveTutorSessionProgress(ctx.sessionId, {
        ...(compteRendu ? { bilan_json: JSON.stringify({ text: compteRendu }) } : {}),
        input_tokens: usageRef.current.inputTokens,
        output_tokens: usageRef.current.outputTokens,
      });

      const avgConf = ctx.isRevision ? flashcardMasteryConfidence(await api.listFlashcards(chapterId)) : avgConfidence(ctx.confidences);
      const overCount = ctx.isRevision ? 0 : overconfident.length;
      const result = await api.completeTutorSession(ctx.sessionId, avgConf, overCount);
      setSchedule({ boxLevel: result.box_level, outcome: result.outcome, nextReviewDate: result.next_review_date });
    } catch (e: any) {
      setError("Impossible de finaliser la session : " + (e?.message ?? e));
    }
  };

  /** Reconstructs in-memory state from a session's persisted JSON and jumps to
   * the start of whichever stage wasn't finished yet. Granularity is per-stage,
   * not per-step within a stage — Découverte always restarts at concept 1 even
   * if you were on concept 5, since only stage-completion snapshots are
   * persisted. Still a large improvement over silently redoing everything. */
  const resumeSession = async (session: TutorSessionRow) => {
    setError(null);
    setPhase("loading");
    try {
      setTutorSessionId(session.id);
      setAdhd(session.adhd_mode_used);
      setIsRevision(session.is_revision);
      setOffline(session.is_offline_lesson);
      const sessionDiff = (DIFFS as readonly string[]).includes(session.difficulty) ? (session.difficulty as Diff) : DIFFS[0];
      setDiff(sessionDiff);
      usageRef.current = { inputTokens: session.input_tokens, outputTokens: session.output_tokens };
      setUsage(usageRef.current);

      const storyData: Story | null = session.story_json ? JSON.parse(session.story_json) : null;
      if (!storyData) {
        // Crashed before the story itself was even saved — nothing usable to resume into.
        await api.abandonTutorSession(session.id);
        setTutorSessionId(null);
        setPhase(reusableStory ? "revision-intro" : "input");
        return;
      }
      setStory(storyData);
      contentRef.current = storyDigest(storyData);

      const cards = existingFlashcards.length ? existingFlashcards : await api.listFlashcards(chapterId);
      setFlashcards(cards);

      // Offline sessions persist their imported QCM at start — restore it so
      // a resume into the flashcards stage doesn't try to regenerate one.
      if (session.qcm_json) {
        try {
          setQcm(JSON.parse(session.qcm_json));
        } catch {
          /* malformed — the QCM stage will surface an error if still needed */
        }
      }

      let confs: ConceptConfidence[] = [];
      if (!session.is_revision) {
        confs = session.confidence_json ? JSON.parse(session.confidence_json) : [];
        if (!session.confidence_json) {
          setPhase("decouverte");
          return;
        }
        setConfidences(confs);
      }

      const missed: QcmQuestion[] = session.qcm_results_json ? JSON.parse(session.qcm_results_json) : [];
      if (session.qcm_score == null || session.qcm_total == null) {
        setPhase("flashcards");
        return;
      }
      const qcmResultLocal = { score: session.qcm_score, total: session.qcm_total, missed };
      setQcmResult(qcmResultLocal);
      setFlashStats({ fails: 0, total: cards.length });
      setEffDiff(sessionDiff);

      if (session.is_offline_lesson) {
        // Offline sessions end right after the QCM — no socratique/exercice.
        await finalizeSession({
          sessionId: session.id,
          isRevision: session.is_revision,
          offline: true,
          confidences: confs,
          qcmResult: qcmResultLocal,
          exoResult: null,
        });
        return;
      }

      if (!session.socratique_transcript_json) {
        setPhase("socratique");
        return;
      }

      let exoResultLocal: { got: number; total: number } | null = null;
      if (!session.is_revision) {
        if (!session.exercice_json) {
          setPhase("exercice");
          return;
        }
        // Everything through the case study was saved but complete_tutor_session
        // never ran (crashed in the gap between that save and the write-back).
        const parsedExercice: { exercice?: Exercice; correction: ExoCorrection | null; draftAnswers?: Record<string, string> } =
          JSON.parse(session.exercice_json);
        if (parsedExercice.correction) {
          const totalPts = parsedExercice.correction.corrections?.reduce((s, c) => s + (c.bareme || 0), 0) || 0;
          const gotPts =
            parsedExercice.correction.total ?? parsedExercice.correction.corrections?.reduce((s, c) => s + (c.note || 0), 0) ?? 0;
          exoResultLocal = { got: gotPts, total: totalPts };
          setExoResult(exoResultLocal);
        } else if (parsedExercice.exercice) {
          // Draft answers were saved but never submitted for correction —
          // resume back into the exercice phase with them restored, rather
          // than treating "some exercice_json exists" as "this phase is done".
          setExoDraft({ exercice: parsedExercice.exercice, answers: parsedExercice.draftAnswers ?? {} });
          setPhase("exercice");
          return;
        }
      }

      await finalizeSession({
        sessionId: session.id,
        isRevision: session.is_revision,
        offline: false,
        confidences: confs,
        qcmResult: qcmResultLocal,
        exoResult: exoResultLocal,
      });
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setPhase(reusableStory ? "revision-intro" : "input");
    }
  };

  const handleAbandonAndRestart = async () => {
    if (inProgressSession) {
      try {
        await api.abandonTutorSession(inProgressSession.id);
      } catch {
        /* best-effort — starting fresh shouldn't be blocked by this */
      }
    }
    setInProgressSession(null);
    setPhase(reusableStory ? "revision-intro" : "input");
  };

  /** Short, targeted flow for a chapter already studied once: skips the
   * narrative Découverte walk and the case-study Exercice entirely — just
   * flashcards (auto-fast if already mastered), a QCM and Socratic dialogue
   * targeted at the prior compte-rendu, then bilan. */
  const handleStartRevision = async (adhdChoice: boolean) => {
    if (!reusableStory) return;
    if (reusableOffline && !reusableQcm) {
      // A lesson chapter revises against its imported QCM; without it there's
      // nothing to grade offline. « Recommencer autrement » re-imports a file.
      setError("Le QCM de la leçon importée est introuvable — relance le chapitre via « Recommencer autrement » en réimportant un fichier leçon.");
      return;
    }
    setAdhd(adhdChoice);
    setError(null);
    setIsRevision(true);
    setOffline(reusableOffline);
    setPhase("loading");
    try {
      const session = await api.startOrResumeTutorSession(chapterId, null, adhdChoice, diff, model, true, reusableOffline);
      setTutorSessionId(session.id);
      setStory(reusableStory);
      contentRef.current = storyDigest(reusableStory);
      if (reusableOffline && reusableQcm) setQcm(reusableQcm);
      await api.saveTutorSessionProgress(session.id, {
        story_json: JSON.stringify(reusableStory),
        ...(reusableOffline && reusableQcm ? { qcm_json: JSON.stringify(reusableQcm) } : {}),
      });
      setFlashcards(existingFlashcards);
      setPhase("flashcards");
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setPhase("revision-intro");
    }
  };

  /** Starts a session from an imported "leçon Claude" file — the offline
   * mirror of handleStart: story/flashcards/QCM come from the file instead of
   * three generation calls, and everything is persisted up-front so a crash
   * resumes without the file. */
  const handleStartLesson = async (lesson: LessonFile, adhdChoice: boolean, lessonVersionId: number) => {
    setDiff(lesson.difficulty);
    setAdhd(adhdChoice);
    setError(null);
    setIsRevision(false);
    setOffline(true);
    setPhase("loading");
    try {
      const session = await api.startOrResumeTutorSession(chapterId, null, adhdChoice, lesson.difficulty, model, false, true, lessonVersionId);
      setTutorSessionId(session.id);
      setStory(lesson.story);
      contentRef.current = storyDigest(lesson.story);
      setQcm(lesson.qcm);
      await api.saveTutorSessionProgress(session.id, {
        story_json: JSON.stringify(lesson.story),
        qcm_json: JSON.stringify(lesson.qcm),
      });
      const comparisonCards = buildConfusionFlashcards(lesson.qcm.questions);
      if (existingFlashcards.length > 0) {
        const knownQuestions = new Set(existingFlashcards.map((card) => card.question));
        const missingComparisons = comparisonCards.filter((card) => !knownQuestions.has(card.question));
        if (missingComparisons.length > 0) {
          const saved = await api.saveFlashcards(chapterId, session.id, missingComparisons);
          setFlashcards(saved);
        } else {
          setFlashcards(existingFlashcards);
        }
      } else {
        const saved = await api.saveFlashcards(
          chapterId,
          session.id,
          [
            ...lesson.flashcards.map((c) => ({ concept_id: String(c.etape ?? ""), question: c.recto, answer: c.verso, source_ref: c.source_ref })),
            ...comparisonCards,
          ],
        );
        setFlashcards(saved);
      }
      setPhase("decouverte");
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setPhase("input");
    }
  };

  const onDecouverteDone = async (confs: ConceptConfidence[]) => {
    setConfidences(confs);
    if (tutorSessionId) {
      await api.saveTutorSessionProgress(tutorSessionId, {
        confidence_json: JSON.stringify(confs),
        input_tokens: usageRef.current.inputTokens,
        output_tokens: usageRef.current.outputTokens,
      });
    }
    const weak = confs.filter((c) => c.val === 1).length;
    const mid = confs.filter((c) => c.val === 2).length;
    const strong = confs.filter((c) => c.val === 3).length;
    goToTransition(
      {
        title: "Direction : Mémorisation",
        lines: [
          `Tu as travaillé ${confs.length} concepts avec ${story?.personnage || "le personnage"}.`,
          `${strong} maîtrisé${strong > 1 ? "s" : ""}, ${mid} compris, ${weak} incertain${weak > 1 ? "s" : ""}.`,
          weak > 0 ? "Les flashcards des concepts incertains arriveront en premier." : "Les flashcards vont ancrer tout ça en mémoire.",
        ],
        cta: "Lancer les flashcards",
      },
      "flashcards",
    );
  };

  const onFlashDone = async (fails: number, total: number) => {
    setFlashStats({ fails, total });

    if (offline) {
      // The QCM came with the lesson file (already in state, at its fixed
      // difficulty) — no generation call, no adaptive bump.
      setEffDiff(diff);
      setQcmAdapted(false);
      goToTransition(
        {
          title: "Direction : Vérification",
          lines: [
            `${total} flashcards maîtrisées, ${fails} passage${fails > 1 ? "s" : ""} en révision.`,
            `Le QCM de ta leçon (${diff}) va vérifier ta compréhension.`,
            ...(adhd ? ["Une question à la fois, feedback immédiat après chaque réponse."] : []),
          ],
          cta: "Lancer le QCM",
        },
        "qcm",
      );
      return;
    }

    const failRate = total > 0 ? fails / total : 0;
    const adapted = failRate < 0.15 && diff !== DIFFS[DIFFS.length - 1];
    const nextDiff = adapted ? bumpDiff(diff) : diff;
    setEffDiff(nextDiff);
    setQcmAdapted(adapted);
    goToTransition(
      {
        title: "Direction : Vérification",
        lines: [
          `${total} flashcards maîtrisées, ${fails} passage${fails > 1 ? "s" : ""} en révision.`,
          adapted ? `Excellente mémorisation — le QCM passe en difficulté "${nextDiff}".` : `Le QCM (${nextDiff}) va vérifier ta compréhension.`,
          ...(adhd ? ["Une question à la fois, feedback immédiat après chaque réponse."] : []),
        ],
        cta: "Lancer le QCM",
        loading: true,
        loadingText: "Génération du QCM adapté…",
      },
      "qcm",
    );

    try {
      const q = await genJson<Qcm>(prompts.qcm(ueCode, nextDiff, story, reusableCompteRendu), contentRef.current ?? (story ? storyDigest(story) : ""), 4096, model);
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
        input_tokens: usageRef.current.inputTokens,
        output_tokens: usageRef.current.outputTokens,
      });
    }

    if (offline) {
      // No socratique/exercice without a live model — the session ends here.
      // Approfondissement reste possible dans la conversation claude.ai.
      if (tutorSessionId) {
        await finalizeSession({
          sessionId: tutorSessionId,
          isRevision,
          offline: true,
          confidences,
          qcmResult: { score, total, missed },
          exoResult: null,
        });
      }
      return;
    }

    const weakConcepts = confidences.filter((c) => c.val === 1).map((c) => c.titre);
    const missedThemes = [...new Set(missed.map((q) => q.theme || "").filter(Boolean))];
    const targets = [...new Set([...missedThemes, ...weakConcepts])];
    goToTransition(
      {
        title: "Direction : Approfondissement",
        lines: [
          `Score QCM : ${score}/${total}.`,
          targets.length ? `Le dialogue socratique va cibler : ${targets.slice(0, 4).join(", ")}${targets.length > 4 ? "…" : ""}.` : "Score parfait — le dialogue va pousser plus loin.",
          ...(adhd ? ["2 échanges suffisent — court et intense."] : []),
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

  const socSys = story
    ? prompts.socrate(ueCode, contentRef.current ? String(contentRef.current).slice(0, 3000) : storyDigest(story).slice(0, 3000), weakLabel, reusableCompteRendu)
    : "";
  const exoSys = story
    ? prompts.exo(ueCode, effDiff || diff, story, reusableCompteRendu) + `\nContenu du cours:\n${contentRef.current ? String(contentRef.current).slice(0, 3000) : storyDigest(story).slice(0, 3000)}`
    : "";

  const onSocDone = async () => {
    if (!tutorSessionId) return;
    await api.saveTutorSessionProgress(tutorSessionId, {
      socratique_transcript_json: JSON.stringify(socratiqueTranscript),
      input_tokens: usageRef.current.inputTokens,
      output_tokens: usageRef.current.outputTokens,
    });

    if (isRevision) {
      await finalizeSession({ sessionId: tutorSessionId, isRevision: true, offline: false, confidences, qcmResult, exoResult: null });
      return;
    }

    goToTransition(
      {
        title: "Direction : Application",
        lines: [
          story?.entreprise ? `Retour chez ${story.entreprise.split(",")[0]} — la situation a évolué.` : "Un cas pratique type annales t'attend.",
          adhd ? "Un dossier à la fois. Rédige ce que tu peux, même partiel — tout compte." : "Rédige tes réponses comme à l'examen, le tuteur corrigera chaque question.",
        ],
        cta: "Découvrir le sujet",
      },
      "exercice",
    );
  };

  const onExoDone = async (got: number, total: number) => {
    const exoResultLocal = { got, total };
    setExoResult(exoResultLocal);
    if (tutorSessionId && exerciceRef.current) {
      await api.saveTutorSessionProgress(tutorSessionId, {
        exercice_json: JSON.stringify(exerciceRef.current),
        input_tokens: usageRef.current.inputTokens,
        output_tokens: usageRef.current.outputTokens,
      });
    }
    if (!tutorSessionId) return;
    await finalizeSession({ sessionId: tutorSessionId, isRevision: false, offline: false, confidences, qcmResult, exoResult: exoResultLocal });
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

  const stages = ALL_STAGES.filter((s) => {
    if (isRevision && (s.id === "decouverte" || s.id === "exercice")) return false;
    // Socratique and exercice both need a live model — offline sessions end at the QCM.
    if (offline && (s.id === "socratique" || s.id === "exercice")) return false;
    return true;
  });
  const currentStageIdx = stages.findIndex((s) => s.id === phase);

  return (
    <div className={`tutor-modal${adhd ? " tutor-nofx" : ""}`}>
      <button className="tutor-close-fab" onClick={handleClose} aria-label="Fermer">✕</button>

      <div className="tutor-body">
        <div style={{ textAlign: "center", marginBottom: 10, marginTop: 6 }}>
          <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 700, letterSpacing: 1 }}>{chapterName.toUpperCase()}</span>
        </div>

        {inSession && !paused && (
          <div className="tutor-prg-track">
            {stages.map((s, i) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {i > 0 && <div className={`tutor-prg-line${i <= currentStageIdx ? " done" : ""}`} />}
                <div className={`tutor-prg-dot${i < currentStageIdx ? " done" : i === currentStageIdx ? " active" : ""}`} title={s.label}>
                  {i < currentStageIdx ? "✓" : i + 1}
                </div>
              </div>
            ))}
          </div>
        )}
        {inSession && !paused && progressHint && (
          <div style={{ textAlign: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 10, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>{progressHint}</span>
            {streak >= 2 && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: "var(--t-acc)", fontFamily: "var(--font-mono)" }}>SÉRIE {streak}</span>}
            {usage.inputTokens + usage.outputTokens > 0 && (
              <span style={{ marginLeft: 8, fontSize: 10, color: "var(--muted)", fontFamily: "var(--font-mono)" }} title="Jetons utilisés dans cette session">
                {formatTokens(usage.inputTokens + usage.outputTokens)} jetons
              </span>
            )}
          </div>
        )}

        {inSession && !paused && showBreakNudge && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "10px 14px",
              marginBottom: 12,
              background: "var(--t-acl)",
              border: "1px solid var(--t-acc)",
              borderRadius: 2,
            }}
          >
            <span style={{ fontSize: 12, color: "var(--t-acc)", fontWeight: 600 }}>25 minutes sur cette session — une petite pause ?</span>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <button
                onClick={() => { setPaused(true); resetBreakClock(); }}
                style={{ background: "var(--t-acc)", color: "#fff", border: "none", borderRadius: 2, padding: "6px 10px", fontSize: 11, fontWeight: 700 }}
              >
                Faire une pause
              </button>
              <button
                onClick={resetBreakClock}
                style={{ background: "transparent", color: "var(--t-acc)", border: "1px solid var(--t-acc)", borderRadius: 2, padding: "6px 10px", fontSize: 11, fontWeight: 700 }}
              >
                Continuer
              </button>
            </div>
          </div>
        )}

        {phase === "checking" && <TutorSpin text="Chargement…" />}

        {phase === "resume-prompt" && inProgressSession && (
          <div className="tutor-card" style={{ textAlign: "center" }}>
            <h3 style={{ fontFamily: "var(--font-story)", fontSize: 18, color: "var(--t-pri)", marginBottom: 8 }}>Session interrompue</h3>
            <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16, lineHeight: 1.6 }}>
              Une session sur ce chapitre a été laissée en cours, sans être terminée — probablement une fermeture inattendue. Rien
              n'a été perdu jusqu'à ce point.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="tutor-bs" style={{ flex: 1 }} onClick={handleAbandonAndRestart}>
                Recommencer à zéro
              </button>
              <button className="tutor-bp" style={{ flex: 2 }} onClick={() => resumeSession(inProgressSession)}>
                Reprendre →
              </button>
            </div>
          </div>
        )}

        {phase === "revision-intro" && reusableStory && (
          <RevisionIntro
            chapterName={chapterName}
            story={reusableStory}
            compteRendu={reusableCompteRendu}
            onStart={handleStartRevision}
            onRestart={() => setPhase("input")}
          />
        )}

        {phase === "input" && <InputPhase chapterId={chapterId} chapterName={chapterName} ueCode={ueCode} onStartLesson={handleStartLesson} />}

        {phase === "loading" && (
          <div className="tutor-card" style={{ textAlign: "center", padding: 40 }}>
            <TutorSpin text={isRevision ? "Préparation de la révision…" : "Construction de ton histoire d'apprentissage…"} />
            {!isRevision && <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>Le reste du parcours se prépare en arrière-plan pendant que tu découvres</p>}
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
            <h3 style={{ fontFamily: "var(--font-story)", fontSize: 18, color: "var(--t-pri)", marginBottom: 10 }}>Session en pause</h3>
            <div className="tutor-trans-recap" style={{ textAlign: "center" }}>
              <strong style={{ color: "var(--t-pri)" }}>Où tu en étais :</strong>
              <br />
              {progressHint || "Ta progression est gelée, rien n'est perdu."}
            </div>
            <button className="tutor-bp" onClick={() => { setPaused(false); resetBreakClock(); }} style={{ width: "100%" }}>
              Reprendre
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
              <DecouvertePhase story={story} ueCode={ueCode} model={model} adhd={adhd} offline={offline} onDone={onDecouverteDone} onHint={setProgressHint} celebrate={celebrate} />
            )}

            {phase === "flashcards" && (
              <FlashcardsPhase cards={flashcards} confidences={confidences} adhd={adhd} onDone={onFlashDone} onHint={setProgressHint} celebrate={celebrate} breakStreak={breakStreak} />
            )}

            {phase === "qcm" && (
              <QCMPhase qcm={qcm} difficulty={effDiff || diff} adapted={qcmAdapted} adhd={adhd} onNext={onQcmDone} onHint={setProgressHint} celebrate={celebrate} breakStreak={breakStreak} />
            )}

            {phase === "socratique" && (
              <SocratPhase sys={socSys} weakLabel={weakLabel} model={model} adhd={adhd} onNext={onSocDone} onHint={setProgressHint} onTranscript={setSocratiqueTranscript} />
            )}

            {phase === "exercice" && (
              <ExoPhase
                sys={exoSys}
                ue={ueCode}
                model={model}
                adhd={adhd}
                initialExercice={exoDraft?.exercice}
                initialAnswers={exoDraft?.answers}
                onHint={setProgressHint}
                celebrate={celebrate}
                onExercice={(exercice, correction) => {
                  exerciceRef.current = { exercice, correction };
                }}
                onDraftSave={(exercice, answers) => {
                  if (tutorSessionId) {
                    api.saveTutorSessionProgress(tutorSessionId, {
                      exercice_json: JSON.stringify({ exercice, correction: null, draftAnswers: answers }),
                    });
                  }
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
                  isRevision,
                }}
                schedule={schedule}
                compteRendu={compteRenduText}
                completedStages={stages.filter((s) => s.id !== "bilan").map((s) => s.label)}
                onFinish={handleFinish}
              />
            )}
          </>
        )}
      </div>

      {inSession && !paused && phase !== "transition" && (
        <button className="tutor-pause-fab" onClick={() => setPaused(true)}>
          Pause
        </button>
      )}

      {inSession && (
        <>
          <button
            onClick={() => setNotesOpen((o) => !o)}
            style={{
              position: "fixed",
              bottom: 16,
              left: 16,
              zIndex: 450,
              padding: "9px 16px",
              borderRadius: 2,
              border: "1px solid var(--border)",
              background: notesOpen ? "var(--t-pri)" : "var(--card)",
              color: notesOpen ? "#fff" : "var(--muted)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.5,
            }}
          >
            Notes{scratchpad.trim() ? " ·" : ""}
          </button>
          {notesOpen && (
            <div
              style={{
                position: "fixed",
                bottom: 56,
                left: 16,
                zIndex: 450,
                width: 260,
                maxWidth: "calc(100vw - 32px)",
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 3,
                padding: 12,
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", letterSpacing: 1, marginBottom: 6 }}>NOTES DE SESSION</div>
              <textarea
                value={scratchpad}
                onChange={(e) => setScratchpad(e.target.value)}
                placeholder="Une pensée qui te distrait ? Note-la ici pour la garder sans perdre le fil."
                rows={5}
                style={{ width: "100%", resize: "vertical", background: "var(--input)", border: "1px solid var(--input-border)", borderRadius: 2, padding: 8, fontSize: 12, color: "var(--text)", fontFamily: "inherit" }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
