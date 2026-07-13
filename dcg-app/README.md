# DCG Étude

Desktop app (Tauri + React) that merges an AI-tutored study session per chapter with
a DCG programme tracker and a spaced-repetition review agenda. Runs natively on
macOS/Windows/Linux; syncs between two machines by storing its SQLite database
inside a folder you already sync (iCloud Drive, Dropbox, OneDrive…).

## Running in development

Requires Node.js and the Rust toolchain. On Linux you also need the WebKitGTK
dev packages (`libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libssl-dev
libayatana-appindicator3-dev libxdo-dev` on Debian/Ubuntu).

```bash
npm install
npm run tauri dev
```

## Building an installer

```bash
npm run tauri build
```

Produces a platform-native bundle under `src-tauri/target/release/bundle/`.

## First run

1. Settings → pick (or create) `dcg.sqlite3` inside a folder you sync between
   your machines. On a second machine, point it at the *same* existing file
   instead of creating a new one.
2. Settings → add an Anthropic API key (console.anthropic.com — billed
   per-token, separate from a claude.ai subscription, which cannot be
   connected to a third-party app). The key is stored in the OS keychain and
   never written into the synced database file.
3. Optionally set an exam date for the dashboard countdown.

## How it fits together

- **Planner shell** (Dashboard / UE detail / Timer): tracks chapters, QCM
  scores, and study-session time — all persisted to SQLite via Rust commands
  (`src-tauri/src/commands/planner.rs`).
- **Tutor** (`src/components/tutor/`): a 7-phase AI-guided session per chapter
  (story-driven discovery → flashcards → QCM → Socratic dialogue → case study →
  summary), calling Anthropic through a Rust command
  (`src-tauri/src/commands/anthropic.rs`) so the API key never reaches the
  webview.
- **Agenda**: chapters return automatically for review based on a
  chapter-level Leitner scheduler (`src-tauri/src/commands/scheduler.rs`,
  unit-tested) driven by each session's QCM score and confidence ratings —
  no manually-maintained weekly planning grid.
