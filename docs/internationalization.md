# Desktop Internationalization

Interleave's desktop app has an offline i18next foundation. The only released language is
English. Simplified Chinese translations for the seven migrated modules are prepared under
`packages/i18n/src/locales/zh-CN/`, but are not registered or available in the app yet. Their
resource contracts are tested directly; Chinese UI layout and Electron integration still need
validation when the language is enabled. This is a partial migration, not a claim that every
screen is translated.

## Research And Selection

Reviewed on 2026-09-15 using upstream source and official contributor documentation:

| Project | Actual implementation | What applies here |
| --- | --- | --- |
| [Excalidraw](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/i18n.ts) (React) | English JSON defines typed nested keys. Locale metadata controls selection and direction. Local imports load translations, with English fallback. A development-only test language exposes untranslated IDs. Its small custom interpolator does not provide a complete plural engine. [Contributions](https://docs.excalidraw.com/docs/introduction/contributing) use Crowdin, with a completion threshold before languages appear. | Derive types from a single English source, register real languages explicitly, and test longer text without publishing the test locale. Use a mature engine for plurals. |
| [Joplin](https://github.com/laurent22/joplin/blob/dev/packages/lib/locale.ts) (Electron/React) | Shared locale state, supported-locale resolution, English fallback, source-string lookup, sprintf interpolation, and gettext plural forms. Message lookup accepts strings rather than an English-key union. [Contributions](https://joplinapp.org/help/dev/localisation/) use POT/PO files and Poedit; the same translations serve desktop, mobile and CLI. | Share resources and resolution across main and renderer; keep the contribution path local and reviewable. Avoid introducing gettext extraction/build tooling solely for this fork. |

Chosen: [i18next](https://www.i18next.com/overview/typescript), pinned in
`packages/i18n/package.json`. It runs in main and renderer without React dependencies, handles
[plurals](https://www.i18next.com/translation-function/plurals) through Intl rules, and supports
[fallback](https://www.i18next.com/principles/fallback). TypeScript literal resources give key and
interpolation checks without a generated duplicate dictionary. React uses a small
`useSyncExternalStore` subscription to the existing i18next instance; no custom translation
engine, network backend, browser language detector, or hosted translation account is required.
The classic typed string API is deliberately explicit (`enableSelector: false`); revisit the
API choice before a future major i18next upgrade.

## Ownership And Resources

- `packages/i18n/src/locales/en/*.ts`: English source modules, exported `as const`.
- `packages/i18n/src/resources.ts`: one registry of shipped language metadata and static imports.
- `packages/i18n/src/index.ts`: pure initialization, resolution and Intl formatters.
- `apps/desktop/src/main/locale.ts`: authoritative desktop language state and native menu rebuild.
- `apps/web/src/i18n.ts`: renderer instance, initialization and React subscription.
- `apps/web/src/components/LanguageSetting.tsx`: saved selection and write-failure feedback.
- `packages/core/src/settings.ts`: preference only, stored as `ui.language`. Core does not import
  i18next, React, or the active presentation locale.

The modules are `common`, `shell`, `settings`, `menu`, `trash`, `optimization`, and `workload`.
Use `module.semanticName` IDs and keep an ID stable when wording changes. Do not use row numbers,
English sentences, database values, route paths or generated hashes as message IDs. Existing
long descriptive IDs are stable identifiers, not keys to regenerate after a copy edit.

Translate whole sentences. For example:

```ts
// locales/en/trash.ts
restoredBatch_one: "Restored {{count, number}} item · {{title}}",
restoredBatch_other: "Restored {{count, number}} items · {{title}}",

// Renderer: subscribe in a component; plain event/helper code can use t directly.
useLocale();
t("trash.restoredBatch", { count: items.length, title: source.title });
```

Do not concatenate a translated prefix, count, English plural suffix, and translated suffix.
Never translate a source title, user's text, file path, protocol identifier, confirmation phrase,
database field, operation code or developer log. React renders interpolated strings as text;
do not insert translations using `dangerouslySetInnerHTML`. `escapeValue: false` is correct for
React text and native menu labels, not permission to render arbitrary HTML.

## Resolution And Lifecycle

1. Missing/invalid legacy preference becomes `system`.
2. An explicit valid preference wins over the system locale. An unsupported explicit preference
   is preserved for future versions but displays English fallback.
3. `system` uses Electron's `app.getLocale()` after readiness.
4. Match a registered BCP 47 tag exactly, then a compatible language/script variant, then `en`.
   `zh-Hans-SG` can match a future `zh-CN`; `zh-TW` does not silently become Simplified Chinese.
5. A missing or empty translated message falls back to the English message.

Main reads SQLite and initializes its menu before creating the window. Renderer subscribes to
`locale:changed` before requesting `locale:get`, and applies the result before mounting React.
If startup IPC fails it logs the failure and mounts in English. `html.lang` and `html.dir` are
updated with presentation state. The bare renderer has no persisted desktop preference.

The setting is saved through existing `settings.updateMany`, validated on main, and recorded as
`set_language` in the same transaction. Migration `0043_stale_prism` adds that allowed operation
while preserving existing log rows and the partial batch index. Legacy non-language settings keep
their existing behavior. General undo ignores `set_language`, so changing display language does
not displace the previous content action. Generic legacy writes to `ui.language` use the same
coercion/logging path and notify the renderer too.

Custom menu labels and migrated UI update on saved preference changes. Electron/OS-provided
menu `role` labels, native picker buttons, spelling services and system locale changes can require
an app/OS restart; this implementation does not override roles or claim to switch OS UI live.
Restore/reset already requires restarting Interleave; that restart also reloads the restored
language preference. An open notification can retain the language used when the operation
completed; later notifications use the current language.

Dates use `Intl.DateTimeFormat`, numbers/percentages/bytes use `Intl.NumberFormat`, and Trash
relative dates use `Intl.RelativeTimeFormat`. These format display values only. Stored ISO
timestamps, local-day/timezone semantics, priority/scheduling calculations and sort order remain
unchanged. Diagnostic timestamps and archive IDs remain machine-readable where they identify
the actual artifact. Native Intl units may use `kB` and grouping such as `5,000 ms` in English.

## Add A Language

To add or enable a language (`zh-CN` already has translations prepared in step 1):

1. Add real translations under `packages/i18n/src/locales/zh-CN/`, using the English modules as
   reference. A module can export a `Record<string, string>` checked by `pnpm i18n:check`.
   Omit unfinished keys; do not copy English or insert empty values to imply completion.
2. Statically import those modules and add one `LanguageDefinition` entry in `resources.ts`:
   `code: "zh-CN"`, native name, `direction: "ltr"`, and its module object. This same registry
   drives the settings selector, main/renderer resources, and supported-locale resolution.
3. Preserve interpolation names and formatter specifications such as `{{count, number}}`.
   For each translated plural family include every category required by
   `new Intl.PluralRules("zh-CN").resolvedOptions().pluralCategories` (Chinese uses `other`).
4. Run the checks below and inspect Settings, menus and Trash in the real Electron app.
   Review translations for the registered language before shipping it. A locale with partial
   coverage is technically supported through fallback, but should be disclosed as partial.

Translators own wording, grammar and plural forms. Code contributors own IDs, dynamic arguments,
UI semantics, fallback and layout. Review both resource and call-site changes in one PR. No
external translation service is part of the workflow. Future RTL registration additionally needs
layout validation beyond the initial LTR test language.

## Verification

From the repository root with supported Node 22 and pnpm 9:

```sh
pnpm i18n:check
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @interleave/web build
pnpm --filter @interleave/desktop build
pnpm i18n:check-build
pnpm e2e --project=electron tests/electron/i18n.spec.ts tests/electron/settings.spec.ts
```

`resources.test.ts` checks every registered resource's keys, plural categories, empty values and
interpolation contracts. It parses app call sites with the TypeScript AST and checks literal
message IDs and required arguments. `typecheck.ts` contains compile-only negative checks for
unknown IDs and misspelled interpolation. Tests discover resources through the registry, without
a second key manifest.

The unregistered Chinese resources have a separate check:
`pnpm exec vitest run packages/i18n/src/zh-CN.test.ts`. It directly imports all seven modules,
compares their keys with English, validates interpolation and plural contracts, and exercises
Chinese plural rendering with user content. `pnpm test` includes this check; `pnpm i18n:check`
only covers registered languages and does not establish Chinese translation coverage yet.

On a resource-constrained machine, `pnpm test -- --maxWorkers=4 --testTimeout=180000`
keeps every test and property iteration while limiting concurrent workers and allowing the
existing database property tests more time. Record that command explicitly; a default-timeout
failure is not a pass.

For long-text/restart tests only, set `INTERLEAVE_I18N_TEST=1` for **both** builds and the Electron
test command. On POSIX, prefix each command with `INTERLEAVE_I18N_TEST=1`; in PowerShell set
`$env:INTERLEAVE_I18N_TEST='1'`. Run `tests/electron/i18n.spec.ts`. This adds a generated `en-XA`
fixture, including a deliberately missing menu translation. It never represents a real language.
Unset the variable and rebuild both bundles afterward. `pnpm i18n:check-build` verifies English
resources in main, the Vite output and staged desktop renderer, and rejects pseudo resources.
The distribution script also runs this gate, including when packaging prebuilt output.

Electron tests use isolated temporary data directories and app restart, not a developer vault.
Use the existing OS display or a virtual display on Linux. WSL/Linux execution and simulated
Windows/macOS branches are not native Windows/macOS validation. Native packaging still requires
the target OS and matching SQLite/ONNX binaries; do not cross-package host native addons.

## Migration Inventory

Migrated: shell sidebar/topbar/status bar, user menu, command palette and shortcut catalogue,
Settings including AI/provider controls, search readiness, system diagnostics, backup/restore,
capture settings, optimization/workload panels, custom application menus and the backup picker,
Trash grouping/restoration/purge confirmation/notifications/errors/relative dates. Shared Undo and
help-link labels are migrated where used by these surfaces. Source titles remain user content.

Still to migrate:

- Home, Queue and Process sessions, review/card creation, extraction and reader surfaces.
- Inbox/import modals, PDF/EPUB/media/Markdown/Anki picker text, import jobs and progress.
- Library, search results and facets, inspector/lineage, concepts, analytics and source yield.
- Maintenance, stagnant extracts, retired cards, weekly review and synthesis.
- First-run onboarding, guided tours, contextual coaching and HelpCenter article content.
- Domain-service English result details and legacy error text; Settings translates the error
  wrapper while retaining original diagnostic details. Introduce structured error codes per
  workflow before translating those details, rather than parsing arbitrary error strings.
- Other shared UI copy and formatters, including scheduler explanations and interval displays.

Website, browser extension, API/server, OCR language models and AI output-language selection are
outside this work. Translating a settings label for those controls does not change their behavior.

Current implementation/verification progress is recorded in
[`plans/2026-09-15-i18n-progress.md`](plans/2026-09-15-i18n-progress.md).
