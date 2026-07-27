# DCG Étude

A local web app (Rust/axum server + React frontend, opened in your regular
browser) that turns lesson JSON files prepared with the LLM of your choice into
guided DCG study sessions, then connects them to a programme tracker and a
spaced-repetition review agenda. Single-machine app —
its SQLite database is created automatically in the OS app-data directory on
first launch, no setup required. Everything runs on `127.0.0.1` only; nothing
is exposed to the network.

## Running in development

Requires Node.js and the Rust toolchain. Two processes, in two terminals:

```bash
npm install
npm run server:dev   # Rust server on http://127.0.0.1:4287
npm run dev           # Vite dev server (proxies /api to the Rust server)
```

Open the URL Vite prints (typically `http://localhost:5173`).

## Building for regular use

```bash
npm run build          # builds the frontend into dist/
npm run server:build   # builds a release server binary, embedding dist/
```

This produces a single self-contained binary at
`server/target/release/dcg-server`. Run it directly:

```bash
./server/target/release/dcg-server
```

It opens `http://127.0.0.1:4287` in your default browser automatically. Copy
the binary anywhere you like — the frontend is baked in, nothing else needs
to ship alongside it. Set `DCG_PORT` to use a different port.

## Building on your own Windows PC, from scratch

One-time toolchain installs (each is a normal installer, default options are
fine):

1. **Git** — <https://git-scm.com/download/win>
2. **Node.js LTS** — <https://nodejs.org> (v22 or newer)
3. **Rust** — <https://rustup.rs> → download and run `rustup-init.exe`. When
   it offers to install the *Visual Studio C++ Build Tools*, accept — the
   Rust compiler needs them on Windows.

Then open a **new** PowerShell window (so the installs are on `PATH`) and
run:

```powershell
git clone https://github.com/JarJarBinLifting/JarJarBinLifting.git
cd JarJarBinLifting\dcg-app
npm ci
npm run build
npm run server:build
```

The first compile takes a few minutes. The finished app is one file:

```
JarJarBinLifting\dcg-app\server\target\release\dcg-server.exe
```

Copy it anywhere (Desktop, etc.), rename it if you like, and double-click it —
a console window stays open (that's the local server; keep it open while you
study) and the app opens in your browser. Your data is **not** stored next to
the exe — it lives in the OS app-data directory — so rebuilding or replacing
the exe never touches your database.

### No-install alternative: let GitHub build it

The repository has a build workflow: on GitHub, open **Actions → "Build DCG
Étude" → Run workflow**, wait for the run to finish, then download the
`dcg-etude-windows` artifact from the run page (it's a zip containing
`dcg-server.exe`). macOS and Linux binaries are built by the same run.

## First run

The database is created automatically — nothing to configure. Just:

1. The next DCG exam date defaults to **30 May 2027** and drives the dashboard's
   coverage, consolidation, annales and final-revision phases.
2. Open a chapter, copy its lesson prompt, use it with the complete chapter in
   the LLM of your choice, then import the resulting `dcg-lecon.json`.

## Leçons importées (aucune clé API)

A chapter is always studied from an imported lesson file. The app never sends
the chapter or the student's work to a model:

1. Open the chapter and use **Copier le prompt de la leçon** (the prompt embeds
   the chapter name, UE and chosen QCM difficulty).
2. Paste the prompt into your preferred LLM together with the chapter content
   (pasted text or an attached PDF). Claude replies with a downloadable
   `dcg-lecon.json` containing the story, the flashcards and the QCM — plus
   pre-written feedback for every hypothesis of every story step.
3. Back in the app, **Importer dcg-lecon.json** validates the structure and
   previews the number of notions, flashcards and QCM questions before start.

Sessions started this way run fully offline (`is_offline_lesson` on the
session row): Découverte → Mémorisation → QCM → Bilan, skipping the two
stages that need a live model (Socratic dialogue and corrected case study —
do those in the claude.ai chat if you want them). Everything downstream
still works with zero API calls, because it always was local: QCM grading,
missed questions banked into the quiz éclair and the error notebook,
flashcards feeding the révision éclair, the Leitner agenda, and the bilan's
compte-rendu (composed from the session's structured results instead of by
the model). Revisions of an imported chapter also run offline, reusing the
lesson's QCM.

Settings → "Exporter une sauvegarde" downloads a portable copy of your data
through the browser, any time — useful before a risky change, or just as a
backup, since everything lives in that one local file.

## How it fits together

- **Server** (`server/src/`): a plain axum HTTP server bound to
  `127.0.0.1`. `handlers/settings.rs`, `handlers/planner.rs`, and
  `handlers/tutor.rs` expose the app's data as JSON routes over SQLite;
  `handlers/anthropic.rs` is the only code that talks to
  `api.anthropic.com` — the API key is read server-side
  (`handlers::settings::read_api_key`) and never crosses into an HTTP
  response, so it never reaches the browser.
- **Planner shell** (Dashboard / UE detail / Timer): tracks chapters, QCM
  scores, and study-session time, all persisted to SQLite through the
  planner routes.
- **Lesson library**: every imported lesson is stored as an immutable version
  with its source, model, generation date, prompt/schema version and content
  counts. A chapter shows whether its lesson is ready, outdated or needs
  attention. Flagging, correcting or excluding a card/QCM creates a new
  version; older versions remain recoverable and existing historical lessons
  are migrated into the library automatically.
- **First-run onboarding**: records the student's name, the 30 May 2027 exam
  target and the UE currently in focus. These priorities guide the next new
  chapter without hiding the rest of the programme.
- **Tutor** (`src/components/tutor/`): a guided offline session per chapter
  (story-driven discovery → flashcards → QCM → summary). Every phase's output
  (story, flashcards, confidence ratings and QCM results) is
  saved to the database as it happens, not just at the end.
- **Agenda**: chapters return automatically for review based on a
  chapter-level Leitner scheduler (`server/src/handlers/scheduler.rs`,
  unit-tested) driven by each session's QCM score and confidence ratings —
  no manually-maintained weekly planning grid.
- **Pilotage** (`src/components/shell/Pilotage.tsx`): an exam-oriented risk
  view — an error notebook (carnet d'erreurs) where each mistake climbs a
  5-step revision ladder (recall → guided application → mini-case → timed
  extract → mastered), per-UE exam-skill self-assessments, and a
  current-vs-target mark scenario per UE. Missed QCM questions from tutor
  sessions land in the notebook automatically; already-active notes are
  re-surfaced rather than duplicated.
- **Révision éclair** (`src/components/shell/QuickReview.tsx`): a daily
  spaced-repetition flashcard deck, capped at 20 cards so it stays
  finishable (~5 min). Every card has its own Leitner schedule
  (`next_card_schedule` in `scheduler.rs`, exam-aware like the chapter
  scheduler): a correct answer pushes it further out (1→2→4→8→15→30 days),
  a miss brings it back tomorrow. Cards come from tutor sessions and from
  the error notebook (a note's title/correction becomes a card
  automatically). The whole flow costs zero API calls — cards already
  exist in the database.
- **Quiz éclair** (`src/components/shell/QuickQuiz.tsx`): the same daily
  loop but with real QCM questions you previously missed — every generated
  QCM's misses are banked (`quiz_items`, options + correct answer +
  explication) and re-asked on their own schedule, capped at 10/day.
  Graded server-side, zero API calls. Re-missing a banked question in a
  later session resets its schedule instead of duplicating it.
- **Annales chronométrées** (`src/components/shell/AnnaleModal.tsx`): paste a
  real past paper, copy the generated prompt to your preferred LLM, then import
  the structured JSON and work it against a visible countdown. Answers autosave
  as drafts, so closing mid-attempt resumes. Correction uses the same hand-off:
  copy a prompt containing the copy, then import the correction JSON (optionally
  guided by a pasted official corrigé). Weak answers (< 50% of
  the barème) flow into the error notebook with source `annale`, and the
  working time is logged as a study session.
- **Automatic backups** (`server/src/handlers/backups.rs`): one consistent
  snapshot per day at startup (SQLite online backup API, last 7 kept,
  rotating) plus on-demand snapshots and restore from Settings — restoring
  first safety-snapshots the current database, validates the candidate
  file (integrity check + migration version), and rolls back if the
  restored file can't be opened. Restore also accepts an uploaded file
  (e.g. a manual export from Downloads).
- **Bilan de la semaine** (`server/src/handlers/bilan.rs`, button on the
  Dashboard): the Sunday ritual — study time this week vs last (with a
  per-UE breakdown that shows untouched UEs explicitly), sessions/cards/
  quiz counts, QCM average, error-notebook movement (created, mastered,
  stalled on the ladder), the week's annale scores, and what the next 7
  days ask. Pure SQL, opens instantly.
- **Progress and seven-day review**: the Progrès screen charts six weeks of QCM
  results, programme/lesson/error movement and a rolling seven-day usage check
  so product decisions can be based on a real week of study rather than adding
  features immediately.
- **Fully offline UI**: the fonts are self-hosted and all study, scheduling,
  grading, backup and review work remains on the machine. The LLM hand-off is
  explicit through copied prompts and imported JSON files.
