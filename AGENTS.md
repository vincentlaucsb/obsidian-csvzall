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
- `src/obsidian/`: Obsidian adapter and filesystem helpers.
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

- Do not use dynamic or async imports such as `await import(...)` in Obsidian runtime code under `src/` or `mobile-src/`.
- For desktop runtime Node.js dependencies such as `child_process`, `path`, `fs`, or Electron APIs, use static top-level imports so esbuild emits Obsidian-compatible CommonJS `require(...)` calls in `main.js`.
- Keep mobile runtime code free of Node.js built-ins and Electron APIs entirely.
- Dynamic imports are acceptable in build scripts and tests where Node.js is the actual runtime.
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
- Narrow `TFile`/`TFolder` with `instanceof`, including collection values; do not cast to these types. Keep scalar CSV C0/DEL sanitization free of control-character regexes while preserving run collapsing, Unicode, and literal Markdown escaping.
- Desktop settings use `getSettingDefinitions()` and `update()` with minimum Obsidian 1.13.0. Do not add a leftover `display()` override; keep indexing cheap and side effects in render/action callbacks. Evaluate mobile against its own manifest minimum.
- Production builds must succeed from a clean source archive without `.git` or Git installed. Keep the LF gate and imported `-text` byte preservation active in this mode. Run `npm run check:source-archive` before release and keep its CI check enabled.
- Check dependency advisory ranges and dependency paths, update the lockfile with fixes, and review the Moment override when Obsidian's dependency constraints change. Do not assume an external runtime API removes the need to fix a flagged lockfile dependency.
- Preserve Obsidian defaults and the user's theme in hosted UI: use the standard Modal title, supported semantic button APIs (`setDestructive()` for deletion) and classes such as `mod-cta`. Limit custom CSS to feature layout; shared viewers inherit host styling. Do not restyle native heading typography, control colors, fonts, line heights, padding, or vertical alignment. In authored host CSS, use explicit layout classes instead of `:has()`, and make display rules respect `[hidden]` without `!important`. Preserve canonical imported modules; change shared source upstream and use its sync workflow.
- Follow the official Obsidian developer policies, plugin submission requirements, and plugin guidelines before cutting a release.
- Settings tabs: keep general settings at the top without a heading. Do not use top-level headings like `General`, `Settings`, or the plugin name. If a settings section heading is needed, use `new Setting(containerEl).setName(...).setHeading()` and avoid the word `settings` in the heading.
- UI text should use sentence case. Do not repeat the plugin name in command names; Obsidian already shows the plugin name next to commands.
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
- `native-binaries/manifest.json`: frozen helper source version/commit, build identity, archive SHA-256 and executable SHA-256 pins, independent of the plugin version. Release preparation commits these archives before tagging; publication verifies this snapshot without native compilation. `src/installer/bundledBinaries.generated.ts` derives its version and payloads from this manifest during desktop builds; its checked-in `.d.ts` contract supports clean-checkout linting.
- `mobile-src/manifest.json`: generated mobile plugin version and minimum supported Obsidian app version.
- Upstream embedded viewer HTML `csvzall-embedded-assets` meta content: source build layout contract, independent of plugin releases.
- Upstream `src/viewer_wasm/web/src/host-bridge.js` `HOST_CAPABILITIES` and `scripts/wasm-viewer-contract.mjs` `requiredHostCapabilities`: versioned viewer capabilities, including compact layout, shared shell, editing, and host save protocols. Packaging requires the corresponding source implementation.
- `src/markdown/managedTables.ts` `TableRecipe.version`: legacy inline table recipe schema version (read for migration), independent of plugin releases.
- `src/views/CsvzallTableView.ts` `save-request`/`save-response` `version`: iframe save protocol version, also implemented by the native and WASM viewer source bridges.
- `src/views/viewerDocumentation.ts` `open-documentation` `version`: iframe documentation protocol version, emitted by upstream `src/viewer/modules/sql.mjs`; the host accepts only the fixed SQLite capabilities page.

After every Obsidian validation failure fix, bump the plugin patch version before
creating or retrying a release tag. The release tag, `manifest.json`,
`versions.json`, `package.json`, and `package-lock.json` must all agree.

For the generated mobile plugin, the mobile release tag and generated
`versions.json` must agree with `mobile-src/manifest.json`.

When adding any new version-bearing file, metadata field, generated manifest, or release configuration, add it to this list in the same change.

## Type-safety checks

`npm run lint` must type-check and lint both `src/` and `mobile-src/` with zero
warnings. Keep it required by desktop and mobile builds so release workflows
cannot bypass it. Do not disable the unsafe-value rules to silence unresolved
Node or standard-library types; fix dependency/type resolution instead.
Generated WASM data uses a checked-in declaration contract for clean-checkout
type checking. Behavioral lint regressions live in `tests/lint-config.test.ts`.
Preserve callback receivers and avoid unnecessary type assertions or deprecated
APIs; enforce these requirements with the corresponding TypeScript ESLint rules.
