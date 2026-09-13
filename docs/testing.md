# Regression testing

Run `npm test` before opening a release PR. This builds the desktop bundle,
runs the Node regression suite, then builds and validates the mobile
distribution. CI runs the same command. Generated desktop `main.js` belongs in
the commit; `.mobile-dist/` does not.

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
