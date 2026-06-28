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
- When patching vendored WASM viewer assets, update `scripts/check-wasm-viewer.mjs` and `tests/wasm-viewer-assets.test.ts` so stale keyboard/layout patches cannot ship silently.
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
- If Node.js or Electron APIs are used, keep `isDesktopOnly` set to `true`.

## Version Locations

- `manifest.json`: Obsidian plugin version and minimum supported Obsidian app version.
- `versions.json`: Obsidian plugin compatibility map from plugin version to minimum supported Obsidian app version.
- `package.json`: npm package version.
- `package-lock.json`: npm lockfile root package version.
- `mobile-src/manifest.json`: generated mobile plugin version and minimum supported Obsidian app version.

After every Obsidian validation failure fix, bump the plugin patch version before
creating or retrying a release tag. The release tag, `manifest.json`,
`versions.json`, `package.json`, and `package-lock.json` must all agree.

For the generated mobile plugin, the mobile release tag and generated
`versions.json` must agree with `mobile-src/manifest.json`.

When adding any new version-bearing file, metadata field, generated manifest, or release configuration, add it to this list in the same change.
