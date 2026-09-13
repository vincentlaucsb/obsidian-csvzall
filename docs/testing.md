# Regression testing

Run `npm test` before opening a release PR. This builds the desktop bundle,
runs the Node regression suite, then builds and validates the mobile
distribution. CI runs the same command. Generated desktop `main.js` belongs in
the commit; `.mobile-dist/` does not.

## Type-safety gate

Use Node 20.19+, 22.13+, or 24+ and install the lockfile dependencies with
`npm ci` (including development dependencies). `npm run lint` type-checks
desktop and mobile sources, then runs type-aware ESLint with zero warnings
allowed. Both production build entry points invoke the same check directly,
so `build`, `build:mobile`, and `sync:mobile-repo` cannot bypass it. The PR and
release workflows run it through `npm test` before publishing assets.

The enforced TypeScript ESLint rules are `no-unsafe-call`,
`no-unsafe-member-access`, `no-unsafe-assignment`, `no-unsafe-return`,
`no-unsafe-argument`, `no-redundant-type-constituents`,
`prefer-promise-reject-errors`, and `no-explicit-any`. The regression suite
injects invalid code for every category into both desktop and mobile lint
contexts to verify that the gate rejects it.

The lint project explicitly loads Node types and ES2018 standard library
declarations (including `Promise.finally`). Keep dependencies available:
unresolved declarations can cause an entire chain of Node calls to appear
as unsafe `error` types. TypeScript compilation fails on missing declarations
before ESLint runs. The checked-in asset declaration supplies the mobile
generated-data contract before its implementation is built; it adds no runtime
code and does not introduce Node APIs into the mobile bundle.

The Community scorecard uses its own scan environment. A clean local lint
result does not prove that a published scorecard has refreshed or that its
environment resolved the same dependencies. Investigate unresolved types
instead of disabling unsafe-value rules or adding untyped module shims.

The service tests use mocked Obsidian and process boundaries to exercise
asynchronous failures without installing a plugin into a real vault. The WASM
tests also exercise the packaged save bridge. Asset marker checks supplement
these tests; they do not establish that an interaction works on a device.

Before publishing, check these interactions in a disposable vault:

- Open a CSV and immediately switch files or close the pane while its viewer
  starts. Confirm the remaining pane shows the correct file.
- Disable the desktop plugin while a viewer is starting. Confirm its helper
  process exits.
- Edit a desktop CSV, rename or move it, then restore its original path.
  Confirm the editor preserves changes and saving resumes only after the path
  is restored. Check cancellation of the discard-and-reopen action.
- Create root and nested `.csvzall/charts.json` files. Confirm chart commands
  discover them and configuration edits and deletions are refreshed.
- On mobile, save while continuing to edit. Confirm newer edits remain dirty.
  Simulate a rejected vault write and confirm the editor remains open for retry.
- On Android, edit a cell with the keyboard open and use a grid menu. Confirm
  the viewer layout stays stable and the menu remains usable.

Desktop and mobile release versions are independent. This repository's
desktop version is maintained in `manifest.json`, `versions.json`,
`package.json`, and `package-lock.json`; a separate mobile release uses
`mobile-src/manifest.json`.
