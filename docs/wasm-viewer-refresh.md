# Refreshing the embedded viewer

Runtime behavior belongs in readable csvzall source. The plugin packages the
compiled JavaScript unchanged; it never repairs minified variable names. Save
acknowledgements, edit revisions, and keyboard visibility live in the upstream
WASM host integration. The entire basic editor, shell markup, dialogs, and
stylesheet are shared with the native viewer in upstream `src/viewer/modules/`
and `src/viewer/viewer.css`. Native composes optional SQL and chart modules;
Lite's entry point has no feature imports. See upstream
`docs/shared-viewer-shell.md` for the adapter and feature contracts.

Compact layout also lives upstream. At portrait widths or landscape heights up
to 600 CSS pixels, hosted viewers hide the duplicate filename, keep Save visible,
and put overflowing actions under More actions. The grid includes 100 pixels
plus the bottom safe-area inset of trailing scroll space without adding CSV
rows. Layout changes wait for cell editing and toolbar menus to finish. The
`csvzall-compact-layout-v1` capability prevents an older viewer being imported
without these behaviors. Upstream `scripts/smoke_compact_viewer.cjs` exercises the
real engine, including the compiled embedded distribution.

The host can request a save with `{ source: "obsidian-csvzall", type:
"save-request", version: 1, requestId }`. The viewer stops the active editor,
waits for pending edits and persistence, then returns `save-response` with the
same version/id, `success`, `dirty`, and optional `error`. Navigation may proceed
only after a successful clean response. WASM advertises
`csvzall-host-save-request-v1`; unsupported helpers time out without discarding
edits. The Obsidian confirmation uses the standard title and `mod-cta` Save
button, preserving the user's theme and accent.

## Prerequisites

Install this repository's dependencies with `npm ci`. In the csvzall checkout,
install `src/viewer_wasm/web` dependencies with `npm install` and build the WASM core
using its documented Emscripten build workflow. The web build expects
`out/build/wasm/csvzall_viewer_wasm.js` and `csvzall_viewer_wasm.wasm`.
Rebuild that core whenever its C++ inputs change; this refresh command rebuilds
the web application using those existing core artifacts.

The refresh uses Vite's `embedded` mode (`dist-embedded/`). This source build
inlines the worker and WASM engine; the plugin creates Blob document/script URLs
from its bundled assets because desktop Obsidian blocks JavaScript served through
vault resource URLs. The standalone upstream release still uses the normal
split-asset build. Compiled JavaScript is imported byte-for-byte in both cases.

## One refresh command

From this repository:

```sh
npm run refresh:wasm-viewer -- --source-repo=../csvzall
```

In Windows PowerShell, use `npm.cmd` to ensure the argument separator reaches npm:

```powershell
npm.cmd run refresh:wasm-viewer -- "--source-repo=../csvzall"
```

The source checkout defaults to the sibling `csvzall` directory. Supply another
path for a worktree. The command runs upstream web tests, builds the web app,
imports its distribution, prepares host styles, validates packaged assets, and
runs the plugin's desktop and mobile checks. A failing step stops the workflow.
It does not commit, publish, or rebuild the native executable.

Packaging requires explicit source capabilities and rejects older unsupported
bundles before replacing existing assets. Update upstream source instead of
adding compatibility string replacements. Packaging inlines the unchanged shared
stylesheet; host/mobile layout belongs upstream. Checks require the
`csvzall-shared-shell-v1` and `csvzall-csv-options-v1` source capabilities and
reject SQL/chart UI code in Lite. The CSV options capability requires the shared
dialect/header controls and engine support; importing an older viewer must fail.

`wasm-viewer/csvzall-wasm-viewer.json` records the source commit, dirty-checkout
status, and imported JavaScript SHA-256. Asset validation ensures that the
packaged JavaScript still matches that digest. Commit upstream changes before
the final refresh so the recorded revision is reproducible. Review the generated
asset diff, then commit it with the plugin integration in the companion PR.

The lower-level `sync:wasm-viewer` and `patch:wasm-viewer` commands remain available
for packaging an already-built distribution. The latter's historical name now
means style preparation only. Prefer the full refresh workflow for changes.

Run the manual checks in [the canonical demo vault](demo-vault.md), plus physical
mobile checks for editing with the keyboard open. Source unit tests cover save
failure, acknowledgement ordering, newer edits remaining dirty, and delayed grid
visibility; packaged checks cover capabilities and integrity. Desktop viewer
changes still require a native csvzall rebuild and the companion release.
