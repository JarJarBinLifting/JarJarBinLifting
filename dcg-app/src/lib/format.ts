import type { Chapter, QcmScoreRow } from "./types";

export const chapterProgress = (chapters: Chapter[]): number => {
  if (!chapters.length) return 0;
  return Math.round((chapters.filter((c) => c.status === "done").length / chapters.length) * 100);
};

export const avgScorePct = (scores: QcmScoreRow[]): number | null => {
  if (!scores.length) return null;
  return Math.round(scores.reduce((a, s) => a + (s.score / s.total) * 100, 0) / scores.length);
};

export const fmtDuration = (totalSeconds: number): string => {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
};

export interface Countdown {
  days: number;
  hours: number;
  minutes: number;
  passed: boolean;
}

export const countdownTo = (isoDate: string): Countdown => {
  const target = new Date(`${isoDate}T08:00:00`).getTime();
  const diff = target - Date.now();
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, passed: true };
  return {
    days: Math.floor(diff / 86400000),
    hours: Math.floor((diff % 86400000) / 3600000),
    minutes: Math.floor((diff % 3600000) / 60000),
    passed: false,
  };
};

export const todayIso = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
