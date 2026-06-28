# Mobile Distribution Maintenance

This document is for maintainers of the generated
`obsidian-csvzall-mobile` repository. It is intentionally separate from the
consumer README so the Community plugin page stays focused on user-facing
desktop behavior.

## Overview

The desktop plugin and mobile plugin are released from separate repositories.
The source of truth for mobile code still lives in this repository under
`mobile-src/`, but the Community plugin assets are generated and synced into
the sibling `obsidian-csvzall-mobile` repository.

This split keeps the release artifacts simple:

- The desktop plugin can use Node.js and Electron APIs such as
  `child_process`.
- The mobile plugin must not contain Node.js built-ins, Electron APIs, desktop
  installer code, or desktop helper-process code.
- Desktop and mobile versions can move independently.
- A mobile WASM change should not be able to break the desktop Community
  download, and desktop helper changes should not leak into the mobile bundle.

## Commands

Run these from this repository:

```powershell
npm run test:mobile
npm run sync:mobile-repo
```

`npm run test:mobile` builds `.mobile-dist/` and validates the generated
bundle. `npm run sync:mobile-repo` rebuilds the distribution, validates it, and
copies it into the sibling `obsidian-csvzall-mobile` checkout.

## Generated Assets

The mobile distribution is generated into `.mobile-dist/`. Its `main.js`
embeds the packaged `wasm-viewer/` assets and materializes them into the plugin
directory at runtime. This lets the mobile release use Obsidian's standard
Community plugin asset model:

- `main.js`
- `manifest.json`
- `styles.css`

Do not edit generated files in `.mobile-dist/` or in the generated mobile
repository by hand. Make changes in this repository, then rerun the sync.

## Versioning

Mobile plugin metadata and versioning live in `mobile-src/manifest.json`, not
the desktop `manifest.json`.

When cutting a mobile release:

- Update `mobile-src/manifest.json`.
- Run `npm run test:mobile`.
- Run `npm run sync:mobile-repo`.
- Release from the generated mobile repository with a tag that matches its
  generated `manifest.json` version.

## Validation Rules

The generated mobile bundle is checked by `scripts/check-mobile-dist.mjs`.
Keep that check updated whenever mobile release assumptions change. It should
continue to verify that:

- Required generated files exist.
- The generated manifest matches `mobile-src/manifest.json`.
- Desktop-only Node.js and Electron APIs do not appear in mobile `main.js`.
- The mobile plugin registers CSV ownership only on Obsidian mobile.
- Expected WASM viewer bridge and mobile creation markers are present.

## Runtime Import Rule

Do not use dynamic imports such as `await import(...)` in Obsidian runtime code
under `src/` or `mobile-src/`.

For desktop runtime Node.js dependencies, use static top-level imports so
esbuild emits CommonJS `require(...)` calls. Mobile runtime code must stay free
of Node.js and Electron APIs entirely.
