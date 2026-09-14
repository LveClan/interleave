# Interleave desktop packaging

Interleave is a local-first Electron desktop app. Packaging targets are macOS arm64
(`.app`/`.dmg`) and Windows x64 (NSIS `.exe` installer and ZIP). Build on the target
OS so SQLite, sqlite-vec, and ONNX Runtime match the application. The T050 verification
record below is historical macOS evidence, not Windows acceptance evidence.

## Windows x64

Use a checkout on a Windows drive in native PowerShell or Command Prompt. Install
Node `>=22.13.1 <23` and pnpm `9.12.1`. Keep its `node_modules`, `native`, and `dist`
directories separate from any WSL/Linux checkout. A Windows Node installed outside
the supported range also needs to be switched to Node 22 before installing.

```powershell
node --version
corepack enable pnpm
corepack pnpm --version
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @interleave/desktop dist:win
```

The build downloads Electron and the pinned EmbeddingGemma model on first use;
offline OCR resources come from the dependency installation. Network access to npm,
GitHub releases, and Hugging Face is required for uncached assets. SQLite uses an
upstream Electron prebuild when available; compiling it instead requires Python and
Visual Studio Build Tools with the Desktop development with C++ workload.

Enable the pnpm shim on PATH as shown above: electron-builder invokes `pnpm` itself
to inspect dependencies. Windows model staging and the embedding worker preload the
matching ONNX DLL by absolute path using Koffi, before loading the ONNX Node binding.
This avoids Windows' older system copy. System DLLs are never changed; macOS does not
load or stage this Windows helper dependency.

Output in `apps/desktop/release/`:

- `Interleave-<version>-win-x64-setup.exe`: per-user installer with a selectable path.
- `Interleave-<version>-win-x64.zip`: extract the full directory, then run `Interleave.exe`.
- `win-unpacked/`: the staged application directory.

No Apple credentials or upstream 1Password configuration are needed. Without a Windows
signing certificate, artifacts are unsigned and Windows may display an unknown-publisher
warning. Packaging explicitly disables publishing. Uninstalling preserves application
data under `%APPDATA%\Interleave`; the ZIP also uses this location and is not a separate
portable data profile.

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and relevant Electron tests before
distribution. Check the actual packaged executable for startup, SQLite migrations,
offline model/OCR assets, and restart persistence. Generating an installer alone does
not establish that these flows work on Windows.

The current application UI is English-only: there is no locale setting or Chinese
translation catalog. The bundled OCR worker uses `eng`; Chinese OCR needs additional
language data and worker configuration independently of UI translation.

### Fork verification (2026-09-14)

Built version 0.7.0 on native Windows x64 with Node 22.20.0, pnpm 9.12.1, and
Electron 39.8.10. The NSIS installer and ZIP are unsigned. The final packaging run
used `ELECTRON_BUILDER_COMPRESSION_LEVEL=1` after rebuilding the updated bundle.

- Windows path/native-helper tests: 20 passed. Additional macOS target and signing
  regression checks passed on Linux; no macOS machine was available for a DMG run.
- Windows Electron desktop E2E: 7 passed, with the macOS-only quiet-window test skipped.
  Command: `pnpm e2e --project=electron tests/electron/desktop.spec.ts --workers=1 --timeout=120000`.
- Packaged executable: renderer startup, 43 SQLite migrations, foreign keys, restart
  persistence, real EmbeddingGemma (`ready`, no fallback), sqlite-vec, and bundled
  English OCR passed. OCR recognized `Source Notes` through the packaged utility worker.
- Root `pnpm lint` and `pnpm typecheck` passed. The full `pnpm test` run had 4,890
  passing and 24 failing tests under concurrent build load. Focused reruns passed the
  Inbox, large concept-member query, OCR job, and PDF import failures. Nineteen property
  tests timed out in that full run; the chronic-postpone test still fails because its
  fixed July 2026 fallow date is in the past. Full-suite acceptance remains outstanding.

## macOS arm64

The packager is **additive** around the existing pipeline (`build.mjs` +
`vendor-native.mjs` + the custom `app://` protocol). `electron-builder` is
packaging-only; it wraps the already-built `dist/`.

```sh
# From the repo root (native pnpm — Docker is NOT used for the desktop app):
pnpm --filter @interleave/desktop dist        # → release/Interleave-<ver>-arm64.dmg + release/mac-arm64/Interleave.app

# Faster, no .dmg (CI / constrained envs):
INTERLEAVE_DIST_DIR_ONLY=1 pnpm --filter @interleave/desktop dist   # → release/mac-arm64/Interleave.app

# Re-package an existing dist/ without rebuilding the renderer/bundle:
INTERLEAVE_DIST_SKIP_BUILD=1 pnpm --filter @interleave/desktop dist
```

`pnpm --filter @interleave/desktop dist` builds the renderer, refreshes the Electron-ABI
`better_sqlite3.node`, vendors and verifies sqlite-vec, and bundles main/preload plus
migrations, renderer, OCR, and embedding assets. It then invokes electron-builder for
the host target. Missing required native extensions or embedding-model assets fail the build.

## Architecture notes that make packaging work (read before changing the config)

- **No `@interleave/*` production deps.** The five workspace packages are
  **devDependencies** (`package.json`) — esbuild already inlines them into
  `main.cjs`. If they were production deps, pnpm would symlink them into
  `node_modules/@interleave/*` → `../../packages/*`, and electron-builder's
  production-dependency collector would walk **outside** the app dir and abort
  asar-packing a `.turbo/turbo-build.log` whose relative path escapes the app
  (`… must be under …/apps/desktop/`). Keeping them devDeps is what makes packing
  succeed.
- **`better-sqlite3` JS is bundled into `main.cjs`** (only `electron` +
  better-sqlite3's never-reached `bindings`/`prebuild-install` are external). So the
  packaged app needs **no runtime `node_modules`** at all. The native addon is loaded
  by absolute path via `nativeBinding`, so the JS wrapper's own `require('bindings')`
  is never evaluated.
- **The native addon is `asarUnpack`ed** to `app.asar.unpacked/native/better_sqlite3.node`
  (a `.node` cannot be `dlopen`ed from inside an asar). `native-binding.ts` rewrites
  the in-asar path to the `.unpacked` sibling at runtime.
- **Fonts are self-hosted** (`@fontsource/ibm-plex-*`, imported in
  `apps/web/src/styles.css`; the Google Fonts `@import` in `design/tokens.css` is
  disabled). The packaged renderer makes **zero font network requests** — required for
  the fully-offline `app://` load.
- **Dev/test paths are unchanged.** `electron .` (dev) and the Playwright `launch.ts`
  harness still build + run the same `main.cjs`; the packaged app **ignores**
  `INTERLEAVE_DATA_DIR` / `VITE_DEV_SERVER_URL` (`paths.ts` / `index.ts`).

## Historical T050 Release Notes

The remaining sections record the original macOS MVP verification. Their artifact sizes,
test counts, and deferred features describe that release; consult the current build config
and the platform instructions above for present packaging behavior.

- **Developer ID signing + notarization.** The build IS ad-hoc signed (the
  `afterPack` hook `scripts/adhoc-sign.cjs` runs `codesign --force --deep --sign -`
  and verifies the seal), which is **mandatory on Apple Silicon** — the arm64 kernel
  refuses to load an executable with a missing/broken signature, and electron-builder's
  packaging invalidates Electron's prebuilt seal. WITHOUT this hook the app shipped
  with `Sealed Resources=none` / `Info.plist=not bound` and macOS reported
  **"'Interleave' is damaged and can't be opened"** (this regressed v0.1.1's first
  `.dmg`; `mac.identity: "-"` does NOT work in electron-builder 25.1.8 — it resolves
  "-" as a named keychain identity, finds none, and skips signing).
  Because the build is ad-hoc signed but **not notarized**, a downloaded copy is still
  quarantined; the user clears it once after installing — **right-click → Open does
  NOT work for a quarantined non-notarized app, and that menu item was removed in
  macOS Sequoia**:
  ```sh
  xattr -dr com.apple.quarantine /Applications/Interleave.app
  ```
  For a zero-friction release, add a Developer ID `identity` + `hardenedRuntime: true`
  + entitlements + `mac.notarize` (electron-builder 24+ notarizes via `notarytool` and
  staples), which removes the `xattr` step.
- **App icon** — the default Electron icon is used (`mac.icon` stub left in the
  config). Drop a real `build/icon.icns` for the final release.
- **Windows / Linux targets**, **auto-update** (`electron-updater`), and a
  **universal (x64+arm64)** build — all later-only; adding them is config, not code.

## Definition-of-Done — verified on the PACKAGED app

Verified against `release/mac-arm64/Interleave.app` (arm64), built by `pnpm dist`:

- [x] **Builds + installs as an Electron desktop app on macOS.** `electron-builder`
      produces `release/Interleave-0.0.0-arm64.dmg` (~112 MB) and
      `release/mac-arm64/Interleave.app`. The `.dmg` mounts and shows
      `Interleave.app` + a drag-to-`/Applications` link (the standard install layout).
- [x] **Launches offline from the `app://` protocol.** The packaged app opens its
      window and creates renderer (`WEB_PAGE`) contexts with **no dev server and no
      remote network requests** — verified by launching with `--v=1` and confirming
      zero `https://` `NotifyBeforeURLRequest` to any external host (Google-Fonts
      requests are gone now that fonts are self-hosted).
- [x] **Opens + migrates SQLite via the Electron-ABI `better-sqlite3`.** On first
      launch the packaged app opens `app.sqlite` and runs the Drizzle migrations
      (`dist/drizzle`, shipped inside the asar) — verified by reading the resulting DB:
      **37 tables** present, including `__drizzle_migrations`, the core element tables,
      `operation_log`, `settings`, and the FTS5 search tables. The `asarUnpack`ed
      native addon path works (no `dlopen` failure).
- [x] **SQLite + the asset vault persist in the real app data dir.** The packaged app
      (no `INTERLEAVE_DATA_DIR` override) writes `app.sqlite` (+ `-wal`/`-shm`),
      `assets/`, `exports/`, and `backups/` under
      `~/Library/Application Support/Interleave/`, and they survive quit + relaunch.
- [x] **Backup works.** "Create a backup now" (the in-app prompt, the ⌘B shortcut, the
      ⌘K palette "Create a backup", and the native File → "Back up…" item all call the
      SAME `appApi.createBackup()` — T047) produces a `backups/<timestamp>/` bundle + a
      portable `.zip`, and records `ui.lastBackupAt`. Covered by `backup.spec.ts` +
      `onboarding.spec.ts` (the prompt path) in `pnpm e2e`.
- [x] **The core loop works + survives restart.** The single `mvp-flow.spec.ts`
      Playwright/Electron journey (`import → activate → read → set read-point → extract
      → convert-to-card (Q&A + cloze) → review (grade) → reschedule → search → open
      original source → backup`) runs against the built app and then **restarts it and
      verifies every artifact persisted**. Green under `pnpm e2e`.
- [x] **No raw DB/filesystem APIs exposed to the renderer.** `window.appApi` is the
      narrow typed surface only — there is **no `db.query`** (asserted by
      `contract.test.ts`), and the full Electron security posture is intact
      (`contextIsolation: true`, `nodeIntegration: false`, `sandbox`, no remote module;
      renderer loads via `app://`, never `http`).
- [x] **First-run onboarding + backup prompts are present.** A first-run welcome
      overlay appears once on an empty collection and persists `ui.seenOnboarding` in
      the `settings` table (survives restart); a gentle "no backup in N days" reminder
      (threshold `ui.backupReminderDays`, default 7) surfaces the one-click backup.
      Both proven by `onboarding.spec.ts`.

## Automated gates (native pnpm)

All green at release time:

- `pnpm typecheck` — 10/10 projects.
- `pnpm lint` — Biome clean (315 files).
- `pnpm test` — Vitest 798 passing (73 files), including the new `BackupPrompt`,
  `Onboarding`, `useShellShortcuts` (⌘B), and `contract` (the `menu:createBackup`
  channel) tests.
- `pnpm e2e` — Playwright/Electron **134 passing**, including `mvp-flow.spec.ts`
  (full loop + restart) and the new `onboarding.spec.ts`.
- `pnpm --filter @interleave/desktop dist` — produces the `.app` + `.dmg`.

## The human acceptance gate (not automated)

T050's final acceptance is a real person living in the packaged app **daily for a
week with no manual DB edits**. `pnpm e2e` proves the loop programmatically and this
checklist proves each DoD item on the packaged build; the week-of-use gate is the
honest definition of "shipped MVP" and is the maintainer's sign-off, not a CI check.
