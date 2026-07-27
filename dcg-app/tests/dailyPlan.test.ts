import assert from "node:assert/strict";
import { buildDailyPlan } from "../src/lib/dailyPlan.ts";

const focusedError = { ue_id: 1 };

const shortPlan = buildDailyPlan({
  budgetMinutes: 15,
  phaseId: "coverage",
  focusUeIds: [1],
  dueErrors: [focusedError, focusedError],
  dueFlashcardCount: 20,
  totalDueFlashcardCount: 20,
  dueQuizCount: 10,
  totalDueQuizCount: 10,
  dueChapter: null,
  nextChapter: null,
});
assert.ok(shortPlan.usedMinutes <= 15);
assert.deepEqual(shortPlan.tasks.map((task) => task.kind), ["errors", "cards", "quiz"]);
assert.equal(shortPlan.tasks[0].focused, true);
assert.ok(shortPlan.deferred.errors > 0 || shortPlan.deferred.quiz > 0);

const coveragePlan = buildDailyPlan({
  budgetMinutes: 30,
  phaseId: "coverage",
  focusUeIds: [2],
  dueErrors: [],
  dueFlashcardCount: 0,
  totalDueFlashcardCount: 0,
  dueQuizCount: 0,
  totalDueQuizCount: 0,
  dueChapter: null,
  nextChapter: { id: 7, ue_id: 2 },
});
assert.equal(coveragePlan.tasks.at(-1)?.kind, "new-chapter");
assert.equal(coveragePlan.tasks.at(-1)?.focused, true);

const trainingPlan = buildDailyPlan({
  budgetMinutes: 15,
  phaseId: "training",
  focusUeIds: [],
  dueErrors: [],
  dueFlashcardCount: 0,
  totalDueFlashcardCount: 0,
  dueQuizCount: 0,
  totalDueQuizCount: 0,
  dueChapter: null,
  nextChapter: null,
});
assert.equal(trainingPlan.tasks[0]?.kind, "simulation");

console.log("dailyPlan checks passed");
