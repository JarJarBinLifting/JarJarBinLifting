#!/usr/bin/env node
/**
 * obsidian-bord — one-way dashboard export: app SQLite → Obsidian vault.
 *
 * Reads a COPY of the live database (read-only, safe while the app runs) and
 * regenerates:
 *   <vault>/10_DCG/tableau-de-bord/_bord.md          global index
 *   <vault>/10_DCG/tableau-de-bord/UE*-bord.md       one note per UE
 *   <vault>/10_DCG/tableau-de-bord/erreurs/*.md      mirror of ACTIVE error notes
 *   <vault>/30_Journal/bilan-dcg-<monday>.md         weekly bilan (one per week)
 *
 * Ownership rule: everything under tableau-de-bord/ belongs to this script and
 * is regenerated wholesale on every run. Nothing else in the vault is touched,
 * except the single deterministic bilan-dcg-* file for the current week.
 *
 * The calibration numbers reuse the app's exact formula (calibration.rs):
 * self-rated % = avg(val)/3*100 rounded; gap = assessed - self-rated;
 * overconfident when gap <= -15, cautious when gap >= +15.
 */
import { DatabaseSync } from "node:sqlite";
import { cpSync, mkdirSync, writeFileSync, readdirSync, unlinkSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DB = join(process.env.APPDATA, "com.amadou.dcgetude", "dcg.sqlite3");
const VAULT = "C:\\Users\\Asol\\Documents\\Obsidian\\Amadou";
const BORD = join(VAULT, "10_DCG", "tableau-de-bord");
const ERREURS = join(BORD, "erreurs");
const JOURNAL = join(VAULT, "30_Journal");

// ---- open a read-only copy so the live DB is never touched -----------------
const tmp = join(tmpdir(), `dcg-bord-${Date.now()}.sqlite3`);
cpSync(DB, tmp);
for (const suffix of ["-wal", "-shm"]) {
  if (existsSync(DB + suffix)) cpSync(DB + suffix, tmp + suffix);
}
const db = new DatabaseSync(tmp, { readOnly: true });

const today = new Date();
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const TODAY = iso(today);
const monday = new Date(today);
monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
const MONDAY = iso(monday);
const nextMonday = new Date(monday);
nextMonday.setDate(monday.getDate() + 7);
const lastMonday = new Date(monday);
lastMonday.setDate(monday.getDate() - 7);
const inSevenDays = new Date(today);
inSevenDays.setDate(today.getDate() + 7);

const one = (sql, ...p) => db.prepare(sql).get(...p) ?? {};
const all = (sql, ...p) => db.prepare(sql).all(...p);

// ---- calibration: same math as server/src/handlers/calibration.rs ----------
function confidencePercent(raw) {
  try {
    const vals = JSON.parse(raw).map((e) => e?.val).filter((v) => typeof v === "number" && v >= 1 && v <= 3);
    if (!vals.length) return null;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length / 3) * 100);
  } catch { return null; }
}
const calibStatus = (gap) => (gap <= -15 ? "surconfiance" : gap >= 15 ? "prudence" : "alignée");

function latestCalibration(ueId) {
  const rows = all(
    `SELECT ts.confidence_json cj, ts.qcm_score s, ts.qcm_total t, ts.completed_at
       FROM tutor_sessions ts JOIN chapters c ON c.id = ts.chapter_id
      WHERE c.ue_id = ? AND ts.status = 'completed' AND ts.confidence_json IS NOT NULL
        AND ts.qcm_score IS NOT NULL AND ts.qcm_total > 0
      ORDER BY ts.completed_at DESC LIMIT 5`, ueId);
  for (const r of rows) {
    const self = confidencePercent(r.cj);
    if (self === null) continue;
    const assessed = Math.min(100, Math.max(0, Math.floor((r.s * 100) / r.t)));
    return { gap: assessed - self, self, assessed, date: String(r.completed_at).slice(0, 10) };
  }
  return null;
}

// ---- gather ----------------------------------------------------------------
const ues = all("SELECT id, code, name FROM ues ORDER BY position");
const perUe = ues.map((ue) => {
  const ch = one("SELECT COUNT(*) total, SUM(status='done') done, SUM(status='ongoing') ongoing FROM chapters WHERE ue_id = ?", ue.id);
  const cards = one(
    `SELECT COUNT(*) c FROM flashcards f JOIN chapters c2 ON c2.id = f.chapter_id
      WHERE c2.ue_id = ? AND f.mastered = 0 AND f.next_review_date IS NOT NULL AND f.next_review_date <= ?`, ue.id, TODAY).c ?? 0;
  const quiz = one(
    `SELECT COUNT(*) c FROM quiz_items q JOIN chapters c2 ON c2.id = q.chapter_id
      WHERE c2.ue_id = ? AND q.next_review_date <= ?`, ue.id, TODAY).c ?? 0;
  const lastQcm = one(
    `SELECT s.score, s.total, s.date FROM qcm_scores s JOIN chapters c2 ON c2.id = s.chapter_id
      WHERE c2.ue_id = ? ORDER BY s.date DESC, s.id DESC LIMIT 1`, ue.id);
  const errs = all(
    `SELECT e.id, e.title, e.error_type, e.skill, e.ladder_step, e.next_review_date, e.source,
            c2.name chapter_name, e.my_reasoning, e.correction
       FROM error_notes e LEFT JOIN chapters c2 ON c2.id = e.chapter_id
      WHERE e.ue_id = ? AND e.status = 'active' ORDER BY e.next_review_date`, ue.id);
  const minutes = one(
    `SELECT COALESCE(SUM(duration_seconds),0)/60 m FROM sessions
      WHERE ue_id = ? AND date(ended_at,'localtime') >= ? AND date(ended_at,'localtime') < ?`,
    ue.id, MONDAY, iso(nextMonday)).m ?? 0;
  const chapters = all("SELECT name, status FROM chapters WHERE ue_id = ? ORDER BY position", ue.id);
  return { ue, ch, cards, quiz, lastQcm, errs, minutes, chapters, calib: latestCalibration(ue.id) };
});

// ---- write: erreurs mirrors ------------------------------------------------
const slug = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
mkdirSync(ERREURS, { recursive: true });
for (const f of readdirSync(ERREURS)) if (f.endsWith(".md")) unlinkSync(join(ERREURS, f));

const LADDER = ["rappel actif", "application guidée", "mini-cas", "extrait chronométré"];
const errorLinks = new Map();
for (const { ue, errs } of perUe) {
  for (const e of errs) {
    const name = `erreur-${ue.code.toLowerCase()}-${slug(e.title)}`;
    errorLinks.set(e.id, name);
    const body = [
      "---",
      `genere: dcg-app`, `ue: ${ue.code}`, `type: ${e.error_type}`, `competence: ${e.skill}`,
      `echelon: ${e.ladder_step}`, `prochaine_reprise: ${e.next_review_date}`, `source: ${e.source}`, `maj: ${TODAY}`,
      "---", "",
      `# ${e.title}`, "",
      `Chapitre : ${e.chapter_name ?? "—"} · échelon ${e.ladder_step + 1}/4 (${LADDER[Math.min(e.ladder_step, 3)]}) · reprise le ${e.next_review_date}`, "",
      e.my_reasoning ? `**Mon raisonnement :** ${e.my_reasoning}\n` : "",
      e.correction ? `**Règle / correction :** ${e.correction}\n` : "",
      `> Miroir généré depuis l'app — la reprise se fait dans l'app, le lien vers tes notes de pattern se fait ici.`,
    ].filter((l) => l !== "").join("\n");
    writeFileSync(join(ERREURS, `${name}.md`), body + "\n");
  }
}

// ---- write: per-UE notes ---------------------------------------------------
mkdirSync(BORD, { recursive: true });
const ICON = { done: "✓", ongoing: "◐", todo: "·" };
for (const d of perUe) {
  const { ue } = d;
  const qcmPct = d.lastQcm?.total ? Math.round((d.lastQcm.score * 100) / d.lastQcm.total) : null;
  const fm = [
    "---", `genere: dcg-app`, `ue: ${ue.code}`, `nom: "${ue.name}"`,
    `chapitres_done: ${d.ch.done ?? 0}`, `chapitres_ongoing: ${d.ch.ongoing ?? 0}`, `chapitres_total: ${d.ch.total ?? 0}`,
    `cartes_dues: ${d.cards}`, `quiz_dus: ${d.quiz}`, `erreurs_actives: ${d.errs.length}`,
    `dernier_qcm_pct: ${qcmPct ?? "null"}`,
    `calibration_ecart: ${d.calib ? d.calib.gap : "null"}`,
    `calibration_statut: ${d.calib ? calibStatus(d.calib.gap) : "null"}`,
    `minutes_semaine: ${d.minutes}`, `maj: ${TODAY}`, "---",
  ].join("\n");
  const lines = [fm, "", `# ${ue.code} — ${ue.name}`, "",
    `Référentiel : [[${ue.code}-competences]]`, "",
    `**Aujourd'hui** : ${d.cards} carte${d.cards > 1 ? "s" : ""} due${d.cards > 1 ? "s" : ""} · ${d.quiz} quiz · ${d.errs.length} erreur${d.errs.length > 1 ? "s" : ""} active${d.errs.length > 1 ? "s" : ""} · ${d.minutes} min cette semaine`, ""];
  if (d.calib) lines.push(`**Calibration** (${d.calib.date}) : confiance ${d.calib.self} % vs rappel ${d.calib.assessed} % → écart ${d.calib.gap > 0 ? "+" : ""}${d.calib.gap} (${calibStatus(d.calib.gap)})`, "");
  if (qcmPct !== null) lines.push(`**Dernier QCM** : ${d.lastQcm.score}/${d.lastQcm.total} (${qcmPct} %) le ${d.lastQcm.date}`, "");
  if (d.errs.length) {
    lines.push(`## Erreurs à reprendre`, "");
    for (const e of d.errs) lines.push(`- [[${errorLinks.get(e.id)}|${e.title}]] — échelon ${e.ladder_step + 1}/4, le ${e.next_review_date}`);
    lines.push("");
  }
  lines.push(`## Chapitres (${d.ch.done ?? 0}/${d.ch.total ?? 0})`, "");
  for (const c of d.chapters) lines.push(`- ${ICON[c.status] ?? "·"} ${c.name}`);
  lines.push("", `> Généré par \`tools/obsidian-bord.mjs\` — lecture seule, l'app reste la source de vérité.`);
  writeFileSync(join(BORD, `${ue.code}-bord.md`), lines.join("\n") + "\n");
}

// ---- write: index ----------------------------------------------------------
{
  const rows = perUe.map((d) => {
    const qcm = d.lastQcm?.total ? `${Math.round((d.lastQcm.score * 100) / d.lastQcm.total)} %` : "—";
    const cal = d.calib ? `${d.calib.gap > 0 ? "+" : ""}${d.calib.gap}` : "—";
    return `| [[${d.ue.code}-bord\|${d.ue.code}]] | ${d.ch.done ?? 0}/${d.ch.total ?? 0} | ${d.cards} | ${d.quiz} | ${d.errs.length} | ${qcm} | ${cal} | ${d.minutes} |`;
  });
  const totalCards = perUe.reduce((a, d) => a + d.cards, 0);
  const totalQuiz = perUe.reduce((a, d) => a + d.quiz, 0);
  const body = [
    "---", `genere: dcg-app`, `maj: ${TODAY}`, `cartes_dues_total: ${totalCards}`, `quiz_dus_total: ${totalQuiz}`, "---", "",
    `# Tableau de bord DCG`, "",
    `Mis à jour le ${TODAY} · dû aujourd'hui : **${totalCards} cartes**, **${totalQuiz} quiz**`, "",
    `| UE | Chapitres | Cartes dues | Quiz | Erreurs | Dernier QCM | Calibration | Min/sem |`,
    `|---|---|---|---|---|---|---|---|`,
    ...rows, "",
    `Calibration : écart rappel − confiance ; négatif = surconfiance (seuil ±15).`,
    `Synthèse référentiel : [[_synthese]]`,
  ].join("\n");
  writeFileSync(join(BORD, "_bord.md"), body + "\n");
}

// ---- write: weekly bilan in 30_Journal -------------------------------------
{
  const NEXT = iso(nextMonday), LAST = iso(lastMonday);
  const mins = one(`SELECT COALESCE(SUM(duration_seconds),0)/60 m FROM sessions WHERE date(ended_at,'localtime') >= ? AND date(ended_at,'localtime') < ?`, MONDAY, NEXT).m ?? 0;
  const minsPrev = one(`SELECT COALESCE(SUM(duration_seconds),0)/60 m FROM sessions WHERE date(ended_at,'localtime') >= ? AND date(ended_at,'localtime') < ?`, LAST, MONDAY).m ?? 0;
  const done = one(`SELECT COUNT(*) c FROM tutor_sessions WHERE status='completed' AND date(completed_at,'localtime') >= ? AND date(completed_at,'localtime') < ?`, MONDAY, NEXT).c ?? 0;
  const reviewed = one(`SELECT COUNT(*) c FROM flashcards WHERE last_reviewed_at IS NOT NULL AND date(last_reviewed_at,'localtime') >= ? AND date(last_reviewed_at,'localtime') < ?`, MONDAY, NEXT).c ?? 0;
  const quizDone = one(`SELECT COUNT(*) c FROM quiz_items WHERE last_reviewed_at IS NOT NULL AND date(last_reviewed_at,'localtime') >= ? AND date(last_reviewed_at,'localtime') < ?`, MONDAY, NEXT).c ?? 0;
  const errNew = one(`SELECT COUNT(*) c FROM error_notes WHERE date(created_at,'localtime') >= ? AND date(created_at,'localtime') < ?`, MONDAY, NEXT).c ?? 0;
  const errMastered = one(`SELECT COUNT(*) c FROM error_notes WHERE status='mastered' AND date(updated_at,'localtime') >= ? AND date(updated_at,'localtime') < ?`, MONDAY, NEXT).c ?? 0;
  const dueNext = one(`SELECT (SELECT COUNT(*) FROM flashcards WHERE mastered=0 AND next_review_date > ? AND next_review_date <= ?) + (SELECT COUNT(*) FROM quiz_items WHERE next_review_date > ? AND next_review_date <= ?) c`, TODAY, iso(inSevenDays), TODAY, iso(inSevenDays)).c ?? 0;
  const perUeMin = perUe.filter((d) => d.minutes > 0).map((d) => `- ${d.ue.code} : ${d.minutes} min`);
  mkdirSync(JOURNAL, { recursive: true });
  const body = [
    "---", `genere: dcg-app`, `semaine: ${MONDAY}`, `minutes: ${mins}`, `minutes_prec: ${minsPrev}`,
    `sessions_terminees: ${done}`, `cartes_revues: ${reviewed}`, `quiz_repondus: ${quizDone}`,
    `erreurs_creees: ${errNew}`, `erreurs_maitrisees: ${errMastered}`, `du_semaine_prochaine: ${dueNext}`, "---", "",
    `# Bilan DCG — semaine du ${MONDAY}`, "",
    `Temps d'étude : **${mins} min** (semaine précédente : ${minsPrev} min)`,
    ...(perUeMin.length ? ["", ...perUeMin] : []), "",
    `Sessions de tutorat terminées : ${done} · cartes revues : ${reviewed} · quiz répondus : ${quizDone}`,
    `Erreurs créées : ${errNew} · maîtrisées : ${errMastered}`,
    `Dû sous 7 jours : ${dueNext} éléments`, "",
    `> Généré le ${TODAY} par \`tools/obsidian-bord.mjs\` (mêmes fenêtres lundi→lundi que le bilan de l'app).`,
  ].join("\n");
  writeFileSync(join(JOURNAL, `bilan-dcg-${MONDAY}.md`), body + "\n");
}

db.close();
rmSync(tmp, { force: true });
for (const suffix of ["-wal", "-shm"]) rmSync(tmp + suffix, { force: true });
console.log(`OK — ${ues.length} UE, ${errorLinks.size} erreurs miroir, bilan semaine du ${MONDAY}.`);
console.log(`→ ${BORD}`);
