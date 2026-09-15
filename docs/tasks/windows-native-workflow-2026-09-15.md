# Windows Native Workflow Verification (2026-09-15)

Scope: environment detection, project dependency preparation, desktop compilation
and isolated minimal startup. Baseline: `main`, `f6d7835`; native Windows checkout
was clean before implementation. No commit, push, release or roadmap changes were
made. No M29 functional acceptance suite was started.

## Environment

- Windows 11 Pro x64, build `10.0.26200`; native PowerShell 5.1.26100.9444.
- System Node `26.7.0` is outside root engines. The repository entry selected an
  existing native Node `22.23.2` from PATH without changing the global selection.
- pnpm was initially unavailable; setup installed `9.12.1` under the ignored
  `.interleave/toolchain/` directory. Lockfile remained unchanged.
- Git `2.48.1.windows.1`, GNU Make `4.4.1`, Python `3.13.5` detected.
- MSVC/vswhere unavailable. Both SQLite prebuilds installed successfully, so source
  compilation and system tool installation were unnecessary.
- Git reports administrator ownership of the checkout. Status/diff verification
  used a command-scoped `safe.directory` override. No global trust setting changed;
  doctor reports the ownership warning separately from runtime readiness.

All application/toolchain execution below used Windows executables through fresh
native `powershell.exe -NoProfile` sessions. The agent invoked those sessions from
WSL interop; Linux Node, Linux dependencies, Docker and WSL GUI were not used as
substitutes for Windows verification.

## Completed Checks

| Check | Result |
| --- | --- |
| Initial `node scripts/desktop.mjs doctor` | Correctly exited 1 for missing pnpm/dependencies/native binaries. |
| First `node scripts/desktop.mjs setup` | Installed 706 Windows workspace packages with frozen lockfile and prepared Electron SQLite. |
| Repeated setup, including final script state | Skipped pnpm install; verified/reused Electron binary; retained working Node binary; sqlite-vec vendor/query passed. |
| `node scripts/desktop.mjs build`, then `make build` | Both succeeded using existing Vite and desktop build.mjs; main, preload, worker and runtime resources emitted. |
| `node scripts/desktop.mjs start --smoke` | Built renderer loaded over `app://`; main/preload/renderer/SQLite health checks passed; Electron closed and temporary directory removed. |
| `node scripts/desktop.mjs dev --smoke` | Vite + Electron startup passed at port 5173; server and Electron exited afterwards. |
| Default port occupied by a temporary listener | Selected another free port and passed the same minimal startup checks; listener closed by its owning verification command. |
| Explicit occupied `VITE_DEV_SERVER_URL` | Failed nonzero with EADDRINUSE and the chosen address; no Electron launch. |
| `make doctor` and `node scripts/desktop.mjs pnpm run doctor` | Both passed required runtime checks, reporting the same selected Node/pnpm and optional-tool warnings. |
| `make smoke` with inherited `ELECTRON_RUN_AS_NODE=1`, invalid dev URL, seed flag and invalid data directory | Passed over `app://`; allocated its own data directory; inherited data path was never created. |
| Explicit incompatible Node override | Failed nonzero with selected executable/version and remediation. |
| `node scripts/desktop.mjs pnpm exec node --test scripts/toolchain.test.mjs` | 4/4 passed: engine boundaries, Windows PATH normalization, executable/script paths containing spaces and special-character arguments, errors/nonzero exits, live child/grandchild cleanup. |
| Targeted Biome check on 9 modified JS/JSON files | Passed with no remaining fixes. |
| Native Git `diff --check` | Passed. |
| Native process and temporary-directory inspection after checks | No task-owned Node/Electron/esbuild processes or smoke directories remained. |

Native SQLite `3.53.1` worked independently with Node ABI `127` and Electron
`39.8.10` ABI `140`. Each successful startup reported 46 applied migrations,
`dbOpen=true`, `migrated=true`, `journalMode=wal`, `foreignKeys=1`,
`busyTimeoutMs=5000`, nonempty rendered DOM and a working `window.appApi` bridge.
The smoke data was disposable; no real user database was opened, reset or seeded.

The first startup exposed missing development sqlite-vec staging, causing fallback
through an incompatible bundled ESM loader. Setup now calls the existing native
vendor script; subsequent starts no longer emitted that fallback diagnostic.

## Remaining Acceptance

This verifies the Windows preparation/build/start workflow, not M29 functionality.
Full Vitest, workspace typecheck/lint, Electron E2E, GUI matrices, real media,
performance, packaged installers, signing and publishing were deliberately not run.
No system configuration or credentials were modified. Linux/macOS execution and
packaging were not revalidated in this task.

Existing build warnings remain for CSS `::highlight` minification and large chunks.
Some successful Electron shutdowns emitted GPU command-buffer diagnostics after
the bridge/renderer checks had passed. Real graphics/media acceptance is still
pending. Development builds intentionally skip EmbeddingGemma acquisition;
model-backed search and packaged offline assets require separate acceptance.
