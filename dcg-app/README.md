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
