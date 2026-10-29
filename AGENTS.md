# Repository Guide

## Scope and performance

- Keep work proportional to the user's operation. Startup and opening a CSV must not trigger or wait for vault-wide discovery, reconciliation, or migration. Prepare only the affected file and its relevant export configuration.
- Prefer direct lookups, known export definitions, cached results, and file events. Schedule required broader maintenance separately in bounded, incremental work; an async startup callback does not make a whole-vault scan acceptable.
- When missing or incomplete information makes cleanup unsafe, defer that cleanup and preserve existing content. Do not expand a foreground operation to establish global certainty.
- Validate affected state at the mutation boundary, including concurrent edits. Reuse completed discovery and validation while their inputs remain unchanged.
- Tie new safeguards and recovery machinery to concrete failure modes. Use existing guards where possible; avoid speculative confirmations, fallback layers, and repeated validation.
- Apply these boundaries to the requirements below and linked design plans. Keep each operation responsive while enforcing the guarantees relevant to the state it reads or changes.

## Git synchronization

- When working on `master` or `main`, pull from `origin` before editing if the last successful pull is unknown or more than one hour old. Use `git pull --ff-only origin master` (or `main`, matching the current branch). A fetch alone does not update the working branch.
- During long sessions, refresh again before starting a new independent task once that window has elapsed. Do not assume a checkout is current because an earlier task fetched it.
- Preserve uncommitted and untracked work, and coordinate with other agents using the checkout before pulling. Never reset, discard changes, or force-update a branch to make a pull succeed; inspect and reconcile any overlap or divergence.
- On a feature branch, keep its intended upstream and do not switch branches or merge the default branch merely to satisfy this rule.

## Directory Structure

- `src/main.ts`: Obsidian plugin composition root. It should only load settings, construct services, register views/commands/watchers, and handle unload.
- `src/views/`: Obsidian view classes and view type constants.
- `src/settings/`: Settings types, defaults, normalization, and settings tab UI.
- `src/csv/`: CSV file detection and CSV open/create workflows.
- `src/charts/`: Chart configuration loading, chart command execution, and chart scheduling.
- `src/process/`: `csvzall` child-process startup, command execution, viewer sessions, and process failure handling.
- `src/installer.ts`: Pure download, release asset selection, checksum verification, ZIP extraction, and binary install logic.
- `src/installer/`: Obsidian-facing installer service glue.
- `src/installer/archive.ts` and `src/installer/bundledInstall.ts`: Offline archive extraction, integrity checks, and pinned native helper materialization. Keep the legacy downloader out of the desktop runtime dependency graph.
- `src/logging/`: Event log mutation helpers.
- `src/exports/`: Desktop export reflection, revision ordering, and local configuration reconstruction.
- `src/obsidian/`: Obsidian adapter and filesystem helpers.
- `src/utils/`: General-purpose, pure, browser-safe helpers organized by concern. Import modules directly; keep feature policy in its owning module and Node/Electron APIs out of shared utilities.
- `src/commands/`: Command and context-menu registration.
- `src/watchers/`: Vault event registration.
- `src/chartAutomation.ts` and `src/viewerHelpers.ts`: Pure helper modules covered directly by tests.
- `tests/`: Node test suite for pure helpers, installer behavior, and bundle-level assertions.
- `main.js`: Generated bundle. Do not edit by hand; regenerate with `npm run build` or `npm test`.

## Maintenance Rule

Use LF line endings for repository text, enforced by `.gitattributes`,
`.editorconfig`, and the required lint/build gate. Run `npm run fix:line-endings`
to normalize existing working-tree files, then review the diff. Files marked
`-text` (including imported viewer JavaScript) preserve exact upstream bytes;
do not normalize them or change their recorded digest to silence a failure.

Keep new behavior in the narrowest module that owns the concern. Do not add process, installer, chart, settings UI, or CSV workflow logic directly to `src/main.ts`; add or extend a focused service/module and wire it from `main.ts` instead.

## README writing

`README.md` is consumer-facing copy for the Obsidian Community plugin page.

- Write for someone casually browsing plugins: lead with why they would want to use this one, concrete benefits, and useful examples. Keep the opening focused on what users can accomplish.
- Favor plain language, short paragraphs, and concise feature bullets. Preserve the author's voice; avoid pedantic qualifications and wording changes that do not improve a user's understanding.
- Let self-explanatory controls explain themselves. Document behavior that could surprise a user or affect their decisions, such as Delete removing export configurations while preserving source files and generated content. Keep export management to a concise bulleted list.
- Keep essential platform requirements, limitations, and privacy disclosures brief and practical. Avoid redundant prerequisites, hypothetical edge cases, and explanations of consequences already obvious from a user's explicit choices.
- Verify suspected factual problems against the implementation or authoritative sources before challenging capability or performance claims. Distinguish a dependency's abilities from how the plugin uses it; do not turn an unverified concern into a README caveat.
- Put detailed tutorials, configuration schemas, implementation explanations, and troubleshooting in `docs/`, linking them when useful. Do not expand the README into an operating manual.
- Do not put maintainer-only release, generated asset, sync, packaging, or workflow notes in the README. Put maintainer guidance in `docs/` or `AGENTS.md` instead.

## Obsidian Sync compatibility

- Exports and vault-relative references must work across devices. Retain standard `.csvzall/*.json` CLI files and reflect chart, table, and value definitions through Obsidian's plugin data APIs into `data.json`, reconstructing missing local JSON automatically. Hidden folders cannot be the only Sync copy, even with **Sync all other types** enabled.
- Keep conflict resolution local to each scoped export: newest wins, deterministic ties, retained deletion records, and no timestamp churn for unchanged definitions. Preserve unrelated exports and plugin data, including unknown fields.
- Automatically localize inherited configurations beside their owners: charts beside the source CSV, SQL exports beside each referencing note. Preserve IDs, bindings, pause state, path meaning, metadata, and generated content. Retire inherited entries only after verified durable destination writes; retain relocation lineage for delayed Sync and retry safely. Runtime configurations serve only their direct folder; standalone CLI lookup stays unchanged.
- Clean up SQL definitions only when their live references are known to be gone. Missing notes, staged Sync, renames, or incomplete indexing defer ambiguous cleanup. Missing chart outputs never delete chart configurations; explicit deletion remains available for both kinds. Background failures preserve generated content, recover when dependencies arrive, and avoid repeated notices within a session.
- The plugin owns Obsidian integration through its active configuration folder and explicit `csvzall view --obsidian` mode. It owns hosted automatic chart regeneration; standalone behavior and explicit chart actions remain available. Keep vault/profile discovery, settings access, and Sync logic out of csvzall; do not discover or merge other profiles. Recreate machine-specific helper installations locally and keep shared configuration portable.
- Plugin `data.json` uses **Installed community plugins** syncing; CSV/TSV sources and ordinary JSON use **Sync all other types**. Report disabled prerequisites only when detectable, otherwise unknown; never change Sync settings silently. Retain README's existing oversized-desktop-`main.js` exception and separate installation on each desktop; further Sync Standard accommodation is outside this requirement.

For Sync changes, read [the storage and conflict design](docs/obsidian-sync-export-plan.md),
[direct-folder migration](docs/direct-folder-export-plan.md), and
[targeted testing and helper selection](docs/obsidian-sync-testing.md). Exercise
the affected behavior with delayed/missing files, staged Sync, and concurrent
edits. Verify current [official Sync guidance](https://obsidian.md/help/sync/settings)
when changing storage or Sync integration. The committed helper snapshot may
differ from unpublished local upstream changes. These guarantees do not require
global preflight checks for unrelated operations.

## Viewer theme design

- Matching the active Obsidian theme is intentional product behavior for embedded desktop and mobile CSV viewers. Use the host's resolved colors, accent, interface font, and light/dark mode, including live theme changes, rather than choosing the OS palette independently.
- Keep synchronization in the versioned iframe `postMessage` bridge. Do not persist theme snapshots in the vault or require a CLI restart, CSV reload, or grid recreation for theme changes. Preserve active edits and focus.
- Keep standalone csvzall usable without Obsidian: without a host theme message, the viewer retains its system-aware appearance. Maintain this fallback in the shared upstream receiver and packaged WASM assets.
- See `docs/viewer-theme.md` for protocol, supported theme values, and upstream coordination.

## Canonical local test vault

- `demo-vault/` is the canonical Obsidian test bed. Keep representative CSV fixtures, demo notes, and portable vault configuration in this repository so behavior can be reproduced from a clean checkout.
- Keep local workspace state, caches, plugin installations/builds, helper binaries, credentials, and machine-specific plugin settings untracked. Never copy through plugin symlinks or junctions when importing vault content.
- Development plugin files should resolve to this checkout's build outputs, with vault-local plugin settings isolated from other vaults. Keep setup instructions in `docs/`, and preserve local settings when refreshing the development build.
- Mobile fixtures live in `mobile-demo-vault/` and generate the sibling mobile repository's `demo-vault/`. Sync preserves existing fixture edits and ignored vault state; mobile setup copies ordinary build files for device transfer. See `docs/mobile-demo-vault.md`.

## Runtime Import Rule

- Runtime import restrictions are enforced by [eslint.config.mjs](eslint.config.mjs). Static desktop imports let esbuild emit Obsidian-compatible CommonJS `require(...)` calls. Scripts and tests run in Node and may use dynamic imports.
- Mobile must remain free of Node.js and Electron dependencies, including transitive imports from shared modules. Source lint and the generated mobile bundle scan enforce complementary parts of this requirement.
- When changing runtime imports, add or update bundle-level assertions so `main.js` cannot ship with browser-style dynamic imports for Node.js modules.

## Mobile WASM Viewer Notes

- Keep the hosted viewer layout stable during AG Grid editing, particularly with Android's keyboard open. Use edit lifecycle hooks for visibility; avoid focus-driven keyboard shims and viewport-height clamping. Detailed examples and constraints are in [the viewer maintenance guide](docs/wasm-viewer-refresh.md#mobile-runtime-and-editing-constraints).
- Change shared runtime behavior upstream, then run `npm run refresh:wasm-viewer`. Preserve compiled JavaScript bytes and align capability/digest checks with the imported source; never repair minified bundles.
- Lite is a native-helper-free WASM viewer/editor on desktop and mobile. Keep desktop services, installers, child processes, Node, and Electron out of its source and bundle. Retain the desktop plugin's `isDesktopOnly: true`, one CSV handler per desktop, and mobile-only gating for keyboard/navigation UI.
- Preserve `csvzall Lite` branding, the `csvzall-mobile` plugin/view/command identifiers, and the `obsidian-csvzall-mobile` repository name. Mobile versions remain independent in `mobile-src/manifest.json`.

For mobile changes, use [the build, packaging, and sync workflow](docs/wasm-viewer-refresh.md#mobile-runtime-and-editing-constraints)
and [mobile demo-vault guidance](docs/mobile-demo-vault.md).

## Obsidian Review Rules

- For scorecard, submission, or validation feedback, use [$obsidian-warning-remediation](.agents/skills/obsidian-warning-remediation/SKILL.md). Follow [the remediation workflow](docs/obsidian-warning-remediation.md) for supplied/public feedback, current official guidance, dispositions, and validation records. Apply that workflow when addressing review feedback; it is not a gate for unrelated edits.
- Direct Filesystem Access and Shell Execution are required desktop capabilities for native helper installation and execution. Preserve them, keep `isDesktopOnly: true`, and disclose outside-vault helper access in README. Do not hide APIs or weaken checks to remove capability warnings. Keep process arguments separate from executable paths, avoid shell interpolation, verify managed downloads, and keep mobile free of these dependencies.
- Preserve scalar CSV control-run collapsing, Unicode, and literal Markdown escaping. Lint enforces the type-narrowing and control-regex restrictions.
- Desktop settings use declarative definitions with minimum Obsidian 1.13.0; keep indexing cheap and side effects in render/action callbacks. Evaluate mobile against its own manifest minimum.
- Production builds must succeed from a clean source archive without `.git` or Git installed, retaining LF and imported-byte checks. Keep `npm run check:source-archive` required before release and in CI; [release procedure](docs/bundled-helper.md) owns helper preparation, verification, and publication.
- Check dependency advisory ranges and dependency paths, update the lockfile with fixes, and review the Moment override when Obsidian's dependency constraints change. Do not assume an external runtime API removes the need to fix a flagged lockfile dependency.
- Preserve Obsidian defaults and the user's theme in hosted UI: use the standard Modal title, supported semantic button APIs (`setDestructive()` for deletion) and classes such as `mod-cta`. Limit custom CSS to feature layout; shared viewers inherit host styling. Do not restyle native heading typography, control colors, fonts, line heights, padding, or vertical alignment. In authored host CSS, use explicit layout classes instead of `:has()`, and make display rules respect `[hidden]` without `!important`. Preserve canonical imported modules; change shared source upstream and use its sync workflow.
- Follow the official Obsidian developer policies, plugin submission requirements, and plugin guidelines before cutting a release.
- Settings tabs: keep general controls at the top without a heading. Heading APIs/names and redundant plugin names in command names are enforced by ESLint.
- UI text should use sentence case.
- Keep each distribution's minimum at the lowest version required by its APIs, enforced by `obsidianmd/no-unsupported-api`. Adopting a newer API requires updating the desktop `manifest.json` and current `versions.json` entry together, or `mobile-src/manifest.json` for mobile, to at least its introduction version. Runtime guards do not replace metadata updates. Desktop capability and `isDesktopOnly` requirements above still apply.

## Version Locations

- `manifest.json`: Obsidian plugin version and minimum supported Obsidian app version.
- `versions.json`: Obsidian plugin compatibility map from plugin version to minimum supported Obsidian app version.
- `package.json`: npm package version.
- `package.json` `engines.node`: supported Node.js versions for the lint/build toolchain.
- `package.json` `overrides.moment`: patched transitive dependency version, independent of plugin releases.
- Ignored `.test-build/obsidian-review/complete.json` `guidanceCommit`: official documentation revision used for a remediation run, independent of plugin releases.
- `package-lock.json`: npm lockfile root package version.
- `native-binaries/build.json`: bundled csvzall source version/commit, dependency commit pins, build-tool versions, platform runners, and CMake configuration. The native helper build identity also hashes its workflow and recipe scripts. Changes require release preparation before tagging.
- `.github/workflows/build-obsidian-helpers.yml`: reusable native release build configuration, including action versions and the Node toolchain policy; included in the helper build identity.
- Generated `.test-build/native-results/<target>/receipt.json` (also cached/uploaded by CI): native provenance schema version, helper version/source commit, build identity, and archive/executable checksums, independent of the plugin version.
- `native-binaries/manifest.json`: frozen helper source version/commit, build identity, archive SHA-256 and executable SHA-256 pins, independent of the plugin version. Release preparation commits these archives before tagging; publication verifies this snapshot without native compilation. `src/installer/bundledPayloads.generated.ts` derives its version, shared viewer text, and Brotli executable recipes from this manifest during desktop builds; its checked-in `.d.ts` contract supports clean-checkout linting. The native recipe's legacy `bundledBinaries.generated.ts` generator is separate from plugin payload packaging.
- `src/installer/helperPayload.mjs` `CZP1`: version 1 of the generated helper reconstruction format (size, patch table, remaining bytes), independent of native source and plugin releases. `scripts/share-native-text.mjs` writes this format; reconstruction must preserve the pinned executable SHA-256.
- `scripts/build-windows-sync-test.mjs` generated `development-identity.json` `helperVersion`: local Windows-only test helper version, independent of release pins. Its generated plugin manifest is marked `csvzallDevelopmentBuild`; never publish it as a release. Native preparation smoke tests must acknowledge Obsidian mode version 1 and verify host-owned save automation.
- `mobile-src/manifest.json`: generated mobile plugin version and minimum supported Obsidian app version.
- `src/exports/revisions.ts` `SYNC_SCHEMA` and reflected `Revision.version`: export reflection schema in plugin `data.json`, independent of plugin releases. `src/exports/ExportReflection.ts` local journal `version` is its device-local persistence schema.
- Upstream native viewer startup JSON `obsidianMode.version`: host-owned chart automation protocol, validated by `src/process/CsvzallProcessService.ts`, independent of plugin releases.
- Upstream embedded viewer HTML `csvzall-embedded-assets` meta content: source build layout contract, independent of plugin releases.
- Upstream `src/viewer_wasm/web/src/host-bridge.js` `HOST_CAPABILITIES` and `scripts/wasm-viewer-contract.mjs` `requiredHostCapabilities`: versioned viewer capabilities, including compact layout, shared shell, editing, and host save protocols. Packaging requires the corresponding source implementation.
- `src/markdown/managedTables.ts` `TableRecipe.version`: legacy inline table recipe schema version (read for migration), independent of plugin releases.
- `src/views/CsvzallTableView.ts` `save-request`/`save-response` `version`: iframe save protocol version, also implemented by the native and WASM viewer source bridges.
- `src/views/viewerDocumentation.ts` `open-documentation` `version`: iframe documentation protocol version, emitted by upstream `src/viewer/modules/sql.mjs`; the host accepts only the fixed SQLite capabilities page.
- `src/views/CsvzallTableView.ts` and upstream `src/viewer/modules/note-export.mjs` `version`: note-export capability, insertion request and response protocol, independent of plugin releases.

After every Obsidian validation failure fix, bump the plugin patch version before
creating or retrying a release tag. The release tag, `manifest.json`,
`versions.json`, `package.json`, and `package-lock.json` must all agree.

For the generated mobile plugin, the mobile release tag and generated
`versions.json` must agree with `mobile-src/manifest.json`.

When adding any new version-bearing file, metadata field, generated manifest, or release configuration, add it to this list in the same change.

## Type-safety checks

Choose verification for the files and behavior changed. Documentation-only edits
need link, formatting, and diff review; they do not require plugin builds,
full regression suites, dependency audits, or release preparation. For runtime
changes, run the lint gate and relevant tests. Broaden validation for affected
integration boundaries and use [the release checks](docs/testing.md) when preparing
a release. Reuse successful checks unless their inputs changed or a failure
requires investigation.

Read [eslint.config.mjs](eslint.config.mjs) for mechanical coding requirements,
including unused values, type safety, API compatibility, imports, settings UI,
command naming, and directive descriptions. Run `npm run lint`; it type-checks
both distributions and lints authored TypeScript and MJS with zero warnings.
Keep this gate required by desktop/mobile builds. Fix dependency/type resolution
rather than weakening unsafe-value rules. Generated WASM data retains a checked-in
declaration contract for clean-checkout type checking. Behavioral enforcement
regressions live in `tests/lint-config.test.ts`; bundle checks remain necessary
for generated output and transitive mobile dependencies.
