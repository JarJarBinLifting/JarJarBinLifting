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

export const formatTokens = (n: number): string => {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
};

export const todayIso = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const dateKey = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/** Consecutive-day study streak (Duolingo-style): counts backward from today
 * through every unbroken day that has at least one activity timestamp.
 * Today itself doesn't break the streak if empty — it just isn't counted
 * yet — so the streak doesn't visibly drop to 0 first thing in the morning
 * before the user has had a chance to study. `dates` accepts any ISO-ish
 * string (date-only or full timestamp); only the first 10 chars are used. */
export const computeStudyStreak = (dates: string[]): number => {
  const days = new Set(dates.map((d) => d.slice(0, 10)));
  let streak = 0;
  const cursor = new Date();
  if (!days.has(dateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(dateKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
};

/** Days since the most recent activity timestamp, or null if there's none
 * yet. Used to detect "it's been a while" gaps for the gentle re-entry
 * prompt on the Dashboard. */
export const daysSinceLastActivity = (dates: string[]): number | null => {
  if (!dates.length) return null;
  const latestKey = dates.map((d) => d.slice(0, 10)).sort().at(-1)!;
  const [y, m, day] = latestKey.split("-").map(Number);
  const latest = new Date(y, m - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  latest.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - latest.getTime()) / 86400000);
};
