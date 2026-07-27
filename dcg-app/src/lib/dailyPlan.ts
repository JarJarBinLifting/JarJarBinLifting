import type { Chapter, DueChapter, ErrorNote } from "./types";
import type { ExamPhaseId } from "./examPlan";

export const DAILY_BUDGETS = [15, 30, 45, 60] as const;

export type DailyBudget = (typeof DAILY_BUDGETS)[number];
export type DailyPlanTaskKind = "errors" | "cards" | "quiz" | "chapter" | "new-chapter" | "simulation";

export interface DailyPlanTask {
  kind: DailyPlanTaskKind;
  key: string;
  minutes: number;
  count?: number;
  total?: number;
  focused?: boolean;
}

export interface DailyPlanInput {
  budgetMinutes: DailyBudget;
  phaseId: ExamPhaseId;
  focusUeIds: number[];
  dueErrors: ErrorNote[];
  dueFlashcardCount: number;
  totalDueFlashcardCount: number;
  dueQuizCount: number;
  totalDueQuizCount: number;
  dueChapter: DueChapter | null;
  nextChapter: Chapter | null;
}

export interface DailyPlan {
  tasks: DailyPlanTask[];
  usedMinutes: number;
  deferred: {
    errors: number;
    cards: number;
    quiz: number;
    chapter: boolean;
  };
}

type ReviewKind = "errors" | "cards" | "quiz";

const minutesFor = (kind: ReviewKind, count: number): number => {
  if (kind === "errors") return count * 5;
  if (kind === "quiz") return count;
  return Math.ceil(count / 4);
};

const countForMinutes = (kind: ReviewKind, minutes: number): number => {
  if (kind === "errors") return Math.floor(minutes / 5);
  if (kind === "quiz") return minutes;
  return minutes * 4;
};

/**
 * Builds a bounded, exam-aware daily sequence without changing any review
 * date. Spaced repetitions remain due until completed; a smaller time budget
 * only limits today's visible batch so a backlog cannot make the learner quit.
 */
export function buildDailyPlan(input: DailyPlanInput): DailyPlan {
  const tasks: DailyPlanTask[] = [];
  let remaining = input.budgetMinutes;

  const addReview = (kind: ReviewKind, wanted: number, total: number, focused = false) => {
    if (wanted <= 0 || remaining <= 0) return;
    const existing = tasks.find((task) => task.kind === kind);
    const current = existing?.count ?? 0;
    const possible = Math.max(0, countForMinutes(kind, remaining));
    const added = Math.min(wanted, possible);
    if (!added) return;

    const nextCount = current + added;
    const addedMinutes = minutesFor(kind, nextCount) - minutesFor(kind, current);
    if (addedMinutes > remaining) return;

    if (existing) {
      existing.count = nextCount;
      existing.minutes += addedMinutes;
      existing.focused ||= focused;
    } else {
      tasks.push({ kind, key: kind, minutes: addedMinutes, count: nextCount, total, focused });
    }
    remaining -= addedMinutes;
  };

  const focusedErrors = input.focusUeIds.length
    ? input.dueErrors.filter((error) => input.focusUeIds.includes(error.ue_id)).length
    : 0;

  // First reserve a short, varied active-recall loop. This avoids spending a
  // whole short session on one backlog while still giving overdue errors first
  // position in the sequence.
  addReview("errors", Math.min(1, input.dueErrors.length), input.dueErrors.length, focusedErrors > 0);
  addReview("cards", Math.min(8, input.dueFlashcardCount), input.totalDueFlashcardCount);
  addReview("quiz", Math.min(3, input.dueQuizCount), input.totalDueQuizCount);

  // Use the remaining time on already-due repetitions before adding new work.
  addReview("cards", Math.max(0, input.dueFlashcardCount - 8), input.totalDueFlashcardCount);
  addReview("quiz", Math.max(0, input.dueQuizCount - 3), input.totalDueQuizCount);
  addReview("errors", Math.max(0, input.dueErrors.length - 1), input.dueErrors.length, focusedErrors > 0);

  if (input.dueChapter && remaining >= 20) {
    tasks.push({ kind: "chapter", key: `chapter:${input.dueChapter.chapter_id}`, minutes: 20 });
    remaining -= 20;
  }

  if ((input.phaseId === "training" || input.phaseId === "final") && remaining >= 12) {
    tasks.push({ kind: "simulation", key: "simulation", minutes: 12 });
    remaining -= 12;
  }

  if (input.phaseId === "coverage" && input.nextChapter && remaining >= 30) {
    tasks.push({ kind: "new-chapter", key: `new-chapter:${input.nextChapter.id}`, minutes: 30, focused: input.focusUeIds.includes(input.nextChapter.ue_id) });
    remaining -= 30;
  }

  const plannedErrors = tasks.find((task) => task.kind === "errors")?.count ?? 0;
  const plannedCards = tasks.find((task) => task.kind === "cards")?.count ?? 0;
  const plannedQuiz = tasks.find((task) => task.kind === "quiz")?.count ?? 0;

  return {
    tasks,
    usedMinutes: input.budgetMinutes - remaining,
    deferred: {
      errors: Math.max(0, input.dueErrors.length - plannedErrors),
      cards: Math.max(0, input.totalDueFlashcardCount - plannedCards),
      quiz: Math.max(0, input.totalDueQuizCount - plannedQuiz),
      chapter: Boolean(input.dueChapter) && !tasks.some((task) => task.kind === "chapter"),
    },
  };
}
