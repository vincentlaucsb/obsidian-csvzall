# Repository Guide

## Directory Structure

- `src/main.ts`: Obsidian plugin composition root. It should only load settings, construct services, register views/commands/watchers, and handle unload.
- `src/views/`: Obsidian view classes and view type constants.
- `src/settings/`: Settings types, defaults, normalization, and settings tab UI.
- `src/csv/`: CSV file detection and CSV open/create workflows.
- `src/charts/`: Chart configuration loading, chart command execution, and chart scheduling.
- `src/process/`: `csvzall` child-process startup, command execution, viewer sessions, and process failure handling.
- `src/installer.ts`: Pure download, release asset selection, checksum verification, ZIP extraction, and binary install logic.
- `src/installer/`: Obsidian-facing installer service glue.
- `src/logging/`: Event log mutation helpers.
- `src/obsidian/`: Obsidian adapter and filesystem helpers.
- `src/commands/`: Command and context-menu registration.
- `src/watchers/`: Vault event registration.
- `src/chartAutomation.ts` and `src/viewerHelpers.ts`: Pure helper modules covered directly by tests.
- `tests/`: Node test suite for pure helpers, installer behavior, and bundle-level assertions.
- `main.js`: Generated bundle. Do not edit by hand; regenerate with `npm run build` or `npm test`.

## Maintenance Rule

Keep new behavior in the narrowest module that owns the concern. Do not add process, installer, chart, settings UI, or CSV workflow logic directly to `src/main.ts`; add or extend a focused service/module and wire it from `main.ts` instead.

`README.md` is consumer-facing copy for the Obsidian Community plugin page. Do
not put maintainer-only release, generated asset, sync, packaging, or workflow
notes there. Put maintainer guidance in `docs/` or `AGENTS.md` instead.

## Viewer theme design

- Matching the active Obsidian theme is intentional product behavior for embedded desktop and mobile CSV viewers. Use the host's resolved colors, accent, interface font, and light/dark mode, including live theme changes, rather than choosing the OS palette independently.
- Keep synchronization in the versioned iframe `postMessage` bridge. Do not persist theme snapshots in the vault or require a CLI restart, CSV reload, or grid recreation for theme changes. Preserve active edits and focus.
- Keep standalone csvzall usable without Obsidian: without a host theme message, the viewer retains its system-aware appearance. Maintain this fallback in the shared upstream receiver and packaged WASM assets.
- See `docs/viewer-theme.md` for protocol, supported theme values, and upstream coordination.

## Canonical local test vault

- `demo-vault/` is the canonical Obsidian test bed. Keep representative CSV fixtures, demo notes, and portable vault configuration in this repository so behavior can be reproduced from a clean checkout.
- Keep local workspace state, caches, plugin installations/builds, helper binaries, credentials, and machine-specific plugin settings untracked. Never copy through plugin symlinks or junctions when importing vault content.
- Development plugin files should resolve to this checkout's build outputs, with vault-local plugin settings isolated from other vaults. Keep setup instructions in `docs/`, and preserve local settings when refreshing the development build.

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
- Keep the desktop plugin manifest `isDesktopOnly` set to `true`. The desktop plugin owns `.csv` on desktop; the generated mobile plugin owns `.csv` only when `Platform.isMobileApp` is true.
- Mobile plugin metadata and versioning live in `mobile-src/manifest.json`, not the desktop `manifest.json`. Update the mobile manifest when cutting a mobile release.

## Obsidian Review Rules

- Follow the official Obsidian developer policies, plugin submission requirements, and plugin guidelines before cutting a release.
- Settings tabs: keep general settings at the top without a heading. Do not use top-level headings like `General`, `Settings`, or the plugin name. If a settings section heading is needed, use `new Setting(containerEl).setName(...).setHeading()` and avoid the word `settings` in the heading.
- UI text should use sentence case. Do not repeat the plugin name in command names; Obsidian already shows the plugin name next to commands.
- Keep `manifest.json` `minAppVersion` at the lowest Obsidian version required by the APIs actually used.
- When adopting a newer Obsidian API, raise `manifest.json` `minAppVersion` and the current release entry in `versions.json` to at least the API's introduction version in the same change. Runtime guards or feature detection are not substitutes for updating this metadata. For mobile APIs, update `mobile-src/manifest.json` instead. Keep the official `obsidianmd/no-unsupported-api` lint rule enabled for each distribution against its own manifest.
- If Node.js or Electron APIs are used, keep `isDesktopOnly` set to `true`.

## Version Locations

- `manifest.json`: Obsidian plugin version and minimum supported Obsidian app version.
- `versions.json`: Obsidian plugin compatibility map from plugin version to minimum supported Obsidian app version.
- `package.json`: npm package version.
- `package.json` `engines.node`: supported Node.js versions for the lint/build toolchain.
- `package-lock.json`: npm lockfile root package version.
- `mobile-src/manifest.json`: generated mobile plugin version and minimum supported Obsidian app version.

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
