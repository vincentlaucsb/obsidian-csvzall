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

When adding any new version-bearing file, metadata field, generated manifest, or release configuration, add it to this list in the same change.
