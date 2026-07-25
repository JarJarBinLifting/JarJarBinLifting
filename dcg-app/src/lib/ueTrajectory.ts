import { DEFAULT_EXAM_DATE, getExamPhase, type ExamPhaseId } from "./examPlan";
import type { Chapter, QcmScoreRow, Ue } from "./types";

export type UeTrajectoryStatus = "complete" | "on_track" | "priority" | "start";

export interface UeTrajectory {
  ue: Ue;
  completedChapters: number;
  totalChapters: number;
  completionPercent: number;
  expectedCoveragePercent: number;
  qcmPercent: number | null;
  nextChapter: string | null;
  status: UeTrajectoryStatus;
  recommendation: string;
}

const DAY_MS = 86_400_000;

function localDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

/** Planned coverage runs from 1 July in the preceding year through 31
 * December. This leaves January onward for consolidation and exam work. */
export function expectedCoveragePercent(examIso = DEFAULT_EXAM_DATE, now = new Date()) {
  const exam = localDate(examIso);
  const start = new Date(exam.getFullYear() - 1, 6, 1, 12);
  const end = new Date(exam.getFullYear() - 1, 11, 31, 12);
  const progress = (now.getTime() - start.getTime()) / Math.max(DAY_MS, end.getTime() - start.getTime());
  return Math.round(Math.max(0, Math.min(1, progress)) * 100);
}

function averageQcmPercent(chapterIds: Set<number>, scores: QcmScoreRow[]) {
  const relevant = scores.filter((score) => chapterIds.has(score.chapter_id) && score.total > 0);
  if (!relevant.length) return null;
  const earned = relevant.reduce((sum, score) => sum + score.score, 0);
  const available = relevant.reduce((sum, score) => sum + score.total, 0);
  return available > 0 ? Math.round((earned / available) * 100) : null;
}

function recommendationFor(input: {
  phase: ExamPhaseId;
  completionPercent: number;
  expected: number;
  qcmPercent: number | null;
  nextChapter: string | null;
}) {
  const { phase, completionPercent, expected, qcmPercent, nextChapter } = input;
  if (completionPercent >= 100) {
    return { status: "complete" as const, recommendation: qcmPercent !== null && qcmPercent < 70 ? "Programme couvert : consolide les notions encore fragiles au QCM." : "Programme couvert : entretiens les rappels espacés et les annales." };
  }

  const next = nextChapter ? `Commence par « ${nextChapter} ».` : "Choisis le prochain chapitre non couvert.";
  if (phase === "coverage") {
    if (completionPercent === 0) return { status: "start" as const, recommendation: `À lancer. ${next}` };
    if (completionPercent + 12 < expected) return { status: "priority" as const, recommendation: `Couverture en retard sur la cible de l'année. ${next}` };
    return { status: "on_track" as const, recommendation: `Rythme de couverture cohérent. ${next}` };
  }

  if (qcmPercent === null) return { status: "priority" as const, recommendation: `Mesure cette UE avec un premier QCM, puis cible les lacunes. ${next}` };
  if (qcmPercent < 60) return { status: "priority" as const, recommendation: `Priorité consolidation : ${qcmPercent}% aux QCM. ${next}` };
  if (phase === "training" || phase === "final") return { status: "on_track" as const, recommendation: "Programme les annales et fais revenir chaque erreur dans les révisions espacées." };
  return { status: "on_track" as const, recommendation: `Consolide les chapitres vus et avance sur la couverture restante. ${next}` };
}

/** Builds an explicit trajectory for every UE from the local programme and
 * measured QCM results. It deliberately avoids inventing a target mark: the
 * learner sees a coverage pace and the next reversible action instead. */
export function buildUeTrajectories(
  ues: Ue[],
  chapters: Chapter[],
  qcmScores: QcmScoreRow[],
  examIso = DEFAULT_EXAM_DATE,
  now = new Date(),
): UeTrajectory[] {
  const phase = getExamPhase(examIso, now).id;
  const expected = expectedCoveragePercent(examIso, now);

  return ues
    .map((ue) => {
      const ueChapters = chapters.filter((chapter) => chapter.ue_id === ue.id);
      const completedChapters = ueChapters.filter((chapter) => chapter.status === "done").length;
      const totalChapters = ueChapters.length;
      const completionPercent = totalChapters ? Math.round((completedChapters / totalChapters) * 100) : 0;
      const qcmPercent = averageQcmPercent(new Set(ueChapters.map((chapter) => chapter.id)), qcmScores);
      const nextChapter = ueChapters.find((chapter) => chapter.status === "ongoing")?.name
        ?? ueChapters.find((chapter) => chapter.status === "todo")?.name
        ?? null;
      const next = recommendationFor({ phase, completionPercent, expected, qcmPercent, nextChapter });
      return {
        ue,
        completedChapters,
        totalChapters,
        completionPercent,
        expectedCoveragePercent: expected,
        qcmPercent,
        nextChapter,
        ...next,
      };
    })
    .sort((left, right) => {
      const urgency = { priority: 0, start: 1, on_track: 2, complete: 3 };
      return urgency[left.status] - urgency[right.status] || left.ue.position - right.ue.position;
    });
}
