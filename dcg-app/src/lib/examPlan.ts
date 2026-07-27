export const DEFAULT_EXAM_DATE = "2027-05-30";

export type ExamPhaseId = "coverage" | "consolidation" | "training" | "final" | "complete";

export interface ExamPhase {
  id: ExamPhaseId;
  label: string;
  shortLabel: string;
  objective: string;
  guidance: string;
  daysLeft: number;
  progress: number;
}

const DAY_MS = 86_400_000;

function localDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
}

export function getExamPhase(examIso = DEFAULT_EXAM_DATE, now = new Date()): ExamPhase {
  const exam = localDate(examIso);
  const today = startOfDay(now);
  const examYear = exam.getFullYear();
  const consolidationStart = new Date(examYear, 0, 1, 12);
  const trainingStart = new Date(examYear, 2, 1, 12);
  const finalStart = new Date(examYear, exam.getMonth() - 1, exam.getDate(), 12);
  const planStart = new Date(examYear - 1, 6, 1, 12);
  const daysLeft = Math.max(0, Math.ceil((exam.getTime() - today.getTime()) / DAY_MS));
  const totalPlanDays = Math.max(1, (exam.getTime() - planStart.getTime()) / DAY_MS);
  const progress = Math.max(0, Math.min(100, Math.round(((today.getTime() - planStart.getTime()) / DAY_MS / totalPlanDays) * 100)));

  if (today > exam) {
    return { id: "complete", label: "Session terminée", shortLabel: "Terminé", objective: "Faire le bilan", guidance: "Archive tes résultats et prépare la prochaine session.", daysLeft: 0, progress: 100 };
  }
  if (today >= finalStart) {
    return { id: "final", label: "Dernière ligne droite", shortLabel: "Final", objective: "Automatiser et tenir le temps", guidance: "Priorité aux sujets chronométrés et aux erreurs qui coûtent encore des points.", daysLeft, progress };
  }
  if (today >= trainingStart) {
    return { id: "training", label: "Entraînement examen", shortLabel: "Annales", objective: "Transformer le cours en points", guidance: "Mélange les UE, travaille au barème et corrige chaque faiblesse repérée.", daysLeft, progress };
  }
  if (today >= consolidationStart) {
    return { id: "consolidation", label: "Consolidation", shortLabel: "Consolider", objective: "Fermer les lacunes", guidance: "Révise les chapitres fragiles et termine les derniers contenus non couverts.", daysLeft, progress };
  }
  return { id: "coverage", label: "Couverture du programme", shortLabel: "Couvrir", objective: "Comprendre chaque chapitre une première fois", guidance: "Avance régulièrement dans le programme tout en maintenant les rappels déjà dus.", daysLeft, progress };
}

export function weeklyCoverageTarget(remainingChapters: number, examIso = DEFAULT_EXAM_DATE, now = new Date()) {
  if (remainingChapters <= 0) return 0;
  const exam = localDate(examIso);
  const coverageEnd = new Date(exam.getFullYear() - 1, 11, 31, 12);
  const days = Math.max(7, (coverageEnd.getTime() - startOfDay(now).getTime()) / DAY_MS);
  return Math.max(1, Math.ceil(remainingChapters / Math.max(1, Math.ceil(days / 7))));
}
