# Regression testing

Run `npm test` before opening a release PR. This builds the desktop bundle,
runs the Node regression suite, then builds and validates the mobile
distribution. CI runs the same command. Generated desktop `main.js` belongs in
the commit; `.mobile-dist/` does not.

Native release-pipeline regressions also run the standard-library Python
packager, so `npm test` needs Python 3 on PATH (or `NATIVE_HELPER_PYTHON` pointing
to it). They cover build-identity reuse, stale/corrupt receipts, complete-platform
collection, deterministic archives, and safe extraction without compiling C++.
Actual native builds use the pinned tools in `native-binaries/build.json`; see
the [helper release pipeline](bundled-helper.md).

For Community feedback, use the [warning remediation workflow](obsidian-warning-remediation.md)
to retrieve current warnings and official guidance. Before release, run
`npm run check:source-archive` to validate `npm ci` and the production build
without `.git` or preinstalled dependencies. It needs registry access.
CI runs this independently of the normal desktop/mobile regression suite.
The archive LF scan honors ignore rules and text attributes without Git;
imported `-text` assets remain byte-preserved in both modes.

## Type-safety gate

The lint/build gate also checks tracked and non-ignored new text files for LF
line endings. `.gitattributes` controls Git checkouts; `.editorconfig` guides
editors. Run `npm run check:line-endings` independently, or
`npm run fix:line-endings` to normalize existing local files and review the diff.
Binary and explicitly byte-preserved imported assets are excluded. CI runs the
same gate through `npm test`; no local Git hook installation is required.

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

The gate also rejects `TFile`/`TFolder` assertions and control-character regular
expressions in both distributions. Desktop settings reject deprecated
`display()` overrides once `getSettingDefinitions()` is implemented. Keep
desktop tests on the declarative `update()` entry point; mobile retains its
own API minimum. Scalar tests exercise every C0/DEL character, run collapsing,
Unicode, and literal Markdown escaping.

Bare timer calls are also rejected. UI code uses its window's timers. Legacy
download helpers use explicit Node timers and remain covered by pure tests;
the shipped desktop plugin extracts its pinned bundled helper without downloads.
See [bundled helper maintenance](bundled-helper.md) for the version pin,
archive verification, migration, and release checks.

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

Before publishing, check these interactions in the canonical `demo-vault/`
([setup and fixture guidance](demo-vault.md)). Use a disposable copy for
destructive scenarios:

- Open a CSV and immediately switch files or close the pane while its viewer
  starts. Confirm the remaining pane shows the correct file.
- On Obsidian 1.13.0 or later, find the plugin's controls through settings search
  and confirm install/update and clear-log actions refresh the settings rows.
- Check the settings export summary, then use its Configure button and the
  Open exports command. Confirm settings close, an existing exports tab is
  reused, and the list shows running and paused configurations. Configure
  a file with several exports and verify the chooser opens the right options.
  In a SQL export's options, confirm Go to note opens its note at the marker,
  and that legacy entries without an output show Not linked to a note.
  Delete its configurations and confirm the CSV, generated files, and rendered
  note content survive, with note regions detached into ordinary Markdown.
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

## Live browser checks

Use a disposable CSV copied from `demo-vault/` into the ignored
`.test-build/live-browser/` directory. Start a locally built helper with
`csvzall view <disposable.csv> --edit --no-open --startup-json --viewer-assets
<csvzall-checkout>/src/viewer`, and open the exact URL printed in its startup
JSON using the supported in-app browser. Keep the process running throughout
the check; stop it and close the temporary browser tab afterward.

In the Codex Windows sandbox, a server can report successful startup while
loopback connections from the browser time out. The verified route is to run
this test server through `exec_command` with approved
`sandbox_permissions: "require_escalated"`. Keep its existing `127.0.0.1`
binding and session token authentication. Do not change firewall settings,
expose the server on the network, or bypass a browser policy stop. No personal
browser profile or vault is needed.

Use fresh DOM snapshots and role/name locators such as
`getByRole("combobox", { name: "Chart type", exact: true })`. Some legacy
chart controls expose accessible names without HTML label associations, so
`getByLabel` does not find them reliably.

Check the shared Markdown table form's entire CSV, selected columns, SQLite
query preview and query error states. Save an export and inspect the generated
ordinary Markdown file and `.csvzall/charts.json` in the disposable directory.
For the SQL viewer, check Ctrl/Cmd+Enter, Copy Markdown, errors, empty results,
and switching directly from an active cell editor to SQL: the unsaved value
must appear, and returning to Table must preserve the edit. Charts asks to
save or discard unsaved CSV edits before opening; use only the disposable
copy for this check.

These browser checks cover the native viewer host. Check note insertion,
managed region refresh and the Obsidian modal separately in the canonical
demo vault when supported native UI access is available.
