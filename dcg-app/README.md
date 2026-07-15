# DCG Étude

A local web app (Rust/axum server + React frontend, opened in your regular
browser) that merges an AI-tutored study session per chapter with a DCG
programme tracker and a spaced-repetition review agenda. Single-machine app —
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

## First run

The database is created automatically — nothing to configure. Just:

1. Settings → add an Anthropic API key (console.anthropic.com — billed
   per-token, separate from a claude.ai subscription, which cannot be
   connected to a third-party app). The key is stored in the OS keychain,
   read only by the Rust server, and never sent to the browser.
2. Optionally set an exam date for the dashboard countdown.

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
- **Tutor** (`src/components/tutor/`): a 6-stage AI-guided session per chapter
  (story-driven discovery → flashcards → QCM → Socratic dialogue → case study →
  summary). Every phase's output (story, flashcards, confidence ratings, QCM
  results, the full Socratic transcript, the exercise + its correction) is
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
- **Annales chronométrées** (`src/components/shell/AnnaleModal.tsx`, from
  the Pilotage screen): paste a real past exam paper, the model structures
  it into dossiers/questions with a barème (one call), then work it against
  a visible countdown — answers autosave as drafts, so closing mid-attempt
  resumes. Submitting triggers a barème-based correction (one call,
  optionally guided by a pasted official corrigé). Weak answers (< 50% of
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
- **Fully offline UI**: the four fonts are self-hosted (latin-subset
  woff2, ~250 KB, embedded in the binary via the Vite build) — the only
  network dependency left in the entire app is api.anthropic.com for the
  tutor.
