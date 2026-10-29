# Repository Guide

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

- Obsidian Sync compatibility is a product requirement. Features, saved export configurations, and vault-relative references must work across devices using Obsidian Sync. The only accepted exception is the desktop `main.js` exceeding the Sync Standard 5 MB file limit, already documented in README; users install the plugin separately on each desktop.
- Use the hybrid export storage model: csvzall keeps its standard `.csvzall/*.json` configuration files, and obsidian-csvzall reflects chart, table, and value definitions into its standard plugin `data.json` through Obsidian's plugin data APIs. Reconstruct missing local JSON from reflected definitions. Hidden `.csvzall/` folders remain CLI storage, but cannot be the only copy required for Sync; **Sync all other types** does not make hidden folders sync.
- Keep Obsidian logic in this plugin. The allowed upstream integration is an explicit `csvzall view --obsidian` mode flag supplied by the plugin; do not add automatic vault/profile discovery, Obsidian settings access, or Sync logic to csvzall. In this mode the plugin owns automatic chart regeneration after CSV saves; standalone behavior and explicit chart actions remain available. The plugin uses Obsidian's active configuration folder directly. Intentionally separate per-device profiles may have separate plugin data; do not discover or merge other profiles.
- Distinguish plugin configuration syncing from ordinary vault-file syncing. Plugin `data.json` uses installed community plugin syncing; CSV/TSV sources and ordinary JSON use **Sync all other types**. Flag disabled prerequisites when detection is reliable, report unknown when unavailable, and never silently change Sync settings. Keep the existing oversized `main.js` disclosure; do not expand this work into further Sync Standard accommodation.
- Resolve conflicting export definitions with newest-wins ordering per scoped export, including deliberate deletions. Reflection, regeneration, polling, and reloads must not make unchanged definitions appear newer. Use deterministic ties and retain deletion records so stale copies cannot resurrect exports. Preserve independent edits to unrelated exports and all unrelated plugin data.
- Preserve stale SQL table/value cleanup when no live note references remain, with safeguards for missing notes, staged Sync, renames, and incomplete indexing. Charts have no stale-definition cleanup: missing or deleted generated chart files do not delete chart configurations. Explicit export deletion remains available for both kinds.
- Migration is automatic reflection, not replacement of the CLI format. Preserve definitions, export IDs, scoped bindings, path meaning, unknown fields, and generated content while localizing inherited entries as described below. Validate and verify durable writes before recording completion; make retries safe. Do not require ongoing manual copying of hidden folders.
- Each folder's `.csvzall` serves only CSVs/export notes directly in that folder. Automatically localize inherited configurations: charts beside the source CSV, SQL exports beside each referencing note. Retire inherited entries only after verified destination writes; preserve relocation lineage so delayed Sync and notes recover without ancestor runtime lookup. See [docs/direct-folder-export-plan.md](docs/direct-folder-export-plan.md). Keep standalone CLI lookup unchanged; the plugin prepares a direct chart config before opening its native viewer.
- Keep shared configuration portable across operating systems and vault locations. Recreate machine-specific helper installations locally rather than requiring users to sync executable paths or generated binaries.
- Validate changes against missing or delayed configuration files, sync arriving in stages, and concurrent edits. Background failures must not cause repeating notices within the same session; preserve existing generated content and allow recovery when required files arrive.
- Official Sync behavior and prerequisites: https://obsidian.md/help/sync/settings. Verify current guidance when changing storage or Sync integration.
- The implementation design and upstream flag contract are in [docs/obsidian-sync-export-plan.md](docs/obsidian-sync-export-plan.md). See [docs/obsidian-sync-testing.md](docs/obsidian-sync-testing.md) for local helper selection and release status; do not assume the committed bundled helper snapshot includes unpublished local upstream changes.

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

- Android keyboard handling inside Obsidian's mobile WebView is fragile. Do not reflow, hide, or resize the WASM viewer layout while an AG Grid cell editor is active.
- Avoid focus-driven keyboard shims for the hosted WASM viewer. Focus can move into AG Grid editor inputs or dropdown/menu roots and cause layout churn or immediate menu dismissal.
- Do not add `body[data-host-mode][data-keyboard-open]` CSS that changes `grid-template-rows`, hides the topbar/footer, or otherwise changes the grid container size during editing.
- Keep the iframe and hosted viewer layout stable. The Obsidian parent may send `viewport-resized` as a refresh signal, but it should not clamp the parent container height from `visualViewport`.
- To keep the edited cell visible on mobile, use AG Grid edit lifecycle hooks. Store the active edit cell from `onCellEditingStarted`, then call AG Grid visibility refreshes such as `ensureIndexVisible(rowIndex, "middle")` and `ensureColumnVisible(column)` after short delays while the Android keyboard settles.
- Never patch compiled/minified WASM viewer JavaScript. Implement runtime behavior in upstream source with explicit host hooks and source-level tests; use `npm run refresh:wasm-viewer` to rebuild, import, and validate it. See `docs/wasm-viewer-refresh.md`.
- Keep `scripts/check-wasm-viewer.mjs` and `tests/wasm-viewer-assets.test.ts` aligned with required source capabilities and the imported JavaScript digest so unsupported or modified bundles cannot ship silently.
- The mobile Community plugin is generated from `mobile-src/` with `npm run build:mobile`, validated with `npm run check:mobile`, and synced into the sibling `obsidian-csvzall-mobile` repo with `npm run sync:mobile-repo`.
- Keep `mobile-src/` free of desktop services, installer code, child processes, Node.js built-ins, and Electron APIs. The generated mobile `main.js` must pass the no-Node marker scan in `scripts/check-mobile-dist.mjs`.
- The mobile distribution embeds the WASM viewer assets into `main.js` and writes them into the plugin directory at runtime, because Obsidian Community installs only `main.js`, `manifest.json`, and optional `styles.css`.
- Keep the native desktop plugin manifest `isDesktopOnly` set to `true`. The generated mobile plugin is a lightweight WASM CSV viewer/editor on both desktop and mobile, with no native helper. Enable only one CSV handler on desktop; do not restore the mobile-only load gate. Keep mobile keyboard and navigation UI gated to mobile in the shared view.
- Mobile plugin metadata and versioning live in `mobile-src/manifest.json`, not the desktop `manifest.json`. Update the mobile manifest when cutting a mobile release.
- The generated plugin's display name is `csvzall Lite`. Preserve its `csvzall-mobile` ID, view and command identifiers, and `obsidian-csvzall-mobile` repository name when changing branding.

## Obsidian Review Rules

- The repository-local agent skill [obsidian-warning-remediation](.agents/skills/obsidian-warning-remediation/SKILL.md) is the reusable entry point for this workflow. Invoke it as `$obsidian-warning-remediation`; keep detailed procedure in `docs/obsidian-warning-remediation.md`.
- Run [the warning remediation workflow](docs/obsidian-warning-remediation.md) for Obsidian scorecard, submission, or validation feedback. Use supplied feedback when available; otherwise retrieve `https://community.obsidian.md/plugins/csvzall#scorecard`. Download current official guidance on each run with `npm run review:obsidian` (or `-- --warnings <file>`), then record findings, dispositions, verification, and unavailable checks in `docs/`.
- Direct Filesystem Access and Shell Execution are required desktop capabilities for native helper installation and execution. Preserve them, keep `isDesktopOnly: true`, and disclose outside-vault helper access in README. Do not hide APIs or weaken checks to remove capability warnings. Keep process arguments separate from executable paths, avoid shell interpolation, verify managed downloads, and keep mobile free of these dependencies.
- Preserve scalar CSV control-run collapsing, Unicode, and literal Markdown escaping. Lint enforces the type-narrowing and control-regex restrictions.
- Desktop settings use declarative definitions with minimum Obsidian 1.13.0; keep indexing cheap and side effects in render/action callbacks. Evaluate mobile against its own manifest minimum.
- Production builds must succeed from a clean source archive without `.git` or Git installed. Keep the LF gate and imported `-text` byte preservation active in this mode. Run `npm run check:source-archive` before release and keep its CI check enabled.
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
- `native-binaries/manifest.json`: frozen helper source version/commit, build identity, archive SHA-256 and executable SHA-256 pins, independent of the plugin version. Release preparation commits these archives before tagging; publication verifies this snapshot without native compilation. `src/installer/bundledPayloads.generated.ts` derives its version and Brotli executable payloads from this manifest during desktop builds; its checked-in `.d.ts` contract supports clean-checkout linting. The native recipe's legacy `bundledBinaries.generated.ts` generator is separate from plugin payload packaging.
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

Read [eslint.config.mjs](eslint.config.mjs) for mechanical coding requirements,
including unused values, type safety, API compatibility, imports, settings UI,
command naming, and directive descriptions. Run `npm run lint`; it type-checks
both distributions and lints authored TypeScript and MJS with zero warnings.
Keep this gate required by desktop/mobile builds. Fix dependency/type resolution
rather than weakening unsafe-value rules. Generated WASM data retains a checked-in
declaration contract for clean-checkout type checking. Behavioral enforcement
regressions live in `tests/lint-config.test.ts`; bundle checks remain necessary
for generated output and transitive mobile dependencies.
