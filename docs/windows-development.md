# Windows native development

Run these commands from a separate native Windows checkout in PowerShell or Command
Prompt. Keep `node_modules`, `apps/desktop/native` and build outputs separate from
WSL/Linux. The repository launcher uses native Node and pnpm on all platforms;
make is an optional wrapper. It does not modify the system PATH, execution policy,
Git trust settings, credentials, or installed Node versions.

## First preparation

```powershell
node scripts/desktop.mjs help
node scripts/desktop.mjs doctor
node scripts/desktop.mjs setup
node scripts/desktop.mjs doctor
```

The first doctor run returns nonzero until required dependencies are ready. It is
read-only and reports versions, executable paths, missing dependencies, and actual
in-memory SQLite queries under both Node and Electron. Git ownership diagnostics
and optional tool availability are reported separately from runtime readiness.

Requirements come from root `package.json`: Node `>=22.13.1 <23`, pnpm `9.12.1`
(`packageManager`), and the committed pnpm lockfile. The launcher can start under
another installed Node version, then selects a compatible native Node from PATH
or installed nvm versions without changing the global selection. Node must be
available to launch the script; installing system tools remains a separate action.

For a custom Node installation, create the ignored `.interleave/toolchain.json`:

```json
{ "node": "C:/path/to/node.exe" }
```

An explicit `INTERLEAVE_NODE` overrides this setting. A missing or incompatible
override fails with a diagnostic instead of silently choosing another runtime.
For a custom pnpm installation, `INTERLEAVE_PNPM_CLI` can identify its `pnpm.cjs`
entry. The selected CLI must match `packageManager` exactly.

`setup` installs pinned pnpm under `.interleave/toolchain` when needed, using the
selected Node's npm. It then runs `pnpm install --frozen-lockfile`. Only dependency
preparation installs software, and only in the project. Uncached packages require
access to npm and Electron/SQLite release downloads. Existing proxy/mirror settings
are inherited. Failed preparation remains incomplete and can be retried.

Repeated setup skips dependency installation if manifests, lockfile, platform,
architecture and Node ABI are unchanged. The Electron SQLite binary is reused only
after its version receipt and a real Electron SQLite query pass. Node's SQLite copy
in `node_modules` is kept separate from `apps/desktop/native/better_sqlite3.node`.
Setup also stages the installed sqlite-vec extension using the existing vendor
script and its functional query check, so the bundled development main process
can resolve the native extension without relying on an ESM package loader.
An owned dependency directory for another OS/architecture is rejected. Unmanaged
dependencies must first pass the native Node SQLite probe; unknown/broken copies
are rejected with a remediation message, never automatically removed.

| Needed For | Tools And Assets |
| --- | --- |
| Development and local builds | Native Node, pinned pnpm, installed workspace dependencies, Electron runtime, Node and Electron SQLite binaries. Git for managing the checkout. |
| Optional convenience | make; no extra shell is required when make is absent. |
| Packaging only | Existing electron-builder target-OS pipeline, installer tools downloaded by it, complete EmbeddingGemma model cache. Signing is optional. |
| Source compilation fallback only | Python plus MSVC Build Tools with Desktop development with C++ and Windows SDK. Not required when upstream Node/Electron SQLite prebuilds are available. |

## Daily commands

| Repository Entry | pnpm Alias | make Alias |
| --- | --- | --- |
| `node scripts/desktop.mjs doctor` | `pnpm doctor` | `make doctor` |
| `node scripts/desktop.mjs setup` | `pnpm run setup` | `make setup` |
| `node scripts/desktop.mjs build` | `pnpm build:desktop` | `make build` |
| `node scripts/desktop.mjs dev` | `pnpm dev` | `make dev` |
| `node scripts/desktop.mjs start` | `pnpm start` | `make start` |
| `node scripts/desktop.mjs start --smoke` | `pnpm smoke:desktop` | `make smoke` |
| `node scripts/desktop.mjs package --win` | `pnpm package:desktop --win` | `make package` |

When pnpm is not on the system PATH, use the repository entry column. Arbitrary
pnpm commands are available as `node scripts/desktop.mjs pnpm <arguments>`, including
`node scripts/desktop.mjs pnpm run doctor`. Use `pnpm run setup` for the setup script:
pnpm also has its own unrelated built-in `setup` command.

`build` runs the existing Vite renderer build followed by `apps/desktop/build.mjs`.
It does not run tests or package an installer. The root `pnpm build` retains its
workspace-wide Turbo meaning; `pnpm build:desktop` and `make build` select only
the desktop workflow.

`dev` builds main/preload/workers and starts Vite plus Electron. The printed URL is
the renderer server; the full app is the Electron window. The default port is 5173;
an occupied default port selects a free one. `VITE_DEV_SERVER_URL` can explicitly
choose a local HTTP origin. An occupied explicit port fails. Closing Electron or
pressing Ctrl+C cleans up this command's child processes.

`start` launches existing local artifacts over `app://`, with no dev server,
rebuild, tests, seed, or publishing. It clears inherited `VITE_DEV_SERVER_URL` and
`ELECTRON_RUN_AS_NODE`. Missing artifacts fail with the build command to run.
Regular `dev` and `start` use normal development app data unless you explicitly set
`INTERLEAVE_DATA_DIR` to an absolute isolated directory.

`start --smoke` and `dev --smoke` always allocate a fresh temporary directory (even
if `INTERLEAVE_DATA_DIR` was inherited), disable seed/background maintenance, check
renderer DOM, preload health, migrated SQLite, WAL and foreign keys, then close
Electron and remove the directory. They use Playwright's CDP client only; they do
not invoke the Electron E2E suite or a GUI feature matrix.
Chromium caches and its single-instance lock are isolated in that directory too.

## Outputs And Packaging

- Renderer: `apps/web/dist/`.
- Main, preload, workers, migrations and staged runtime assets: `apps/desktop/dist/`.
- Electron SQLite: `apps/desktop/native/better_sqlite3.node`.
- Local toolchain/receipts: `.interleave/`, ignored by Git.
- Optional installers/ZIP/unpacked application: `apps/desktop/release/`.

Packaging reuses [the existing desktop release pipeline](../apps/desktop/RELEASE.md),
requires the target OS/architecture and acquires model assets on first use. It
passes `--publish never`; it does not require upstream Apple/1Password credentials
for Windows. Local development does not download the model automatically, so
semantic/model behavior requires separate acceptance. Packaging does not establish
Windows functional acceptance.

## Troubleshooting

- **Node missing/incompatible:** install a compatible native Node or select an existing
  one with `.interleave/toolchain.json`, then rerun doctor. No permanent PATH edits
  are needed once the entry can start.
- **pnpm missing / pnpm.ps1 policy error:** use `node scripts/desktop.mjs ...`.
  Subprocesses execute pnpm's JavaScript entry through selected Node, and execute
  Electron's native binary directly; paths with spaces are passed as arguments.
- **Git dubious ownership:** inspect ownership and trust the checkout only if appropriate.
  A read-only command can use `git -c safe.directory=<absolute-checkout-path> status`.
  The launcher does not add global Git exceptions. This does not prevent runtime builds.
- **Prebuild download failed:** inspect the download error, network/proxy and selected
  versions. Only if a prebuild is unavailable does the vendor script try source
  compilation. Missing Python/MSVC/SDK at that point is a real fallback blocker.
- **ABI mismatch or copied dependencies:** keep separate OS checkouts. Move the incompatible
  generated dependency tree aside yourself, then run setup. Do not run Electron
  rebuild in the shared pnpm package because Node tests need their own ABI.
- **Build changed dependencies:** run setup again; the receipt is invalidated by package
  manifests, lockfile or runtime changes. Builds never silently install dependencies.
- **Port busy:** use the automatically selected default or set an unused local
  `VITE_DEV_SERVER_URL`; never attach Electron to an unrelated server accidentally.

Tests are separate: `node scripts/desktop.mjs pnpm test`, `... pnpm typecheck`, and
`... pnpm e2e` invoke the existing suites only when explicitly requested. This
environment workflow's minimum verification does not replace M29 acceptance.

The [2026-09-15 verification record](tasks/windows-native-workflow-2026-09-15.md)
lists the native Windows checks completed for these commands.
