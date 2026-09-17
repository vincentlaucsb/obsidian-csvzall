# Refreshing the embedded viewer

Runtime behavior belongs in readable csvzall source. The plugin packages the
compiled JavaScript unchanged; it never repairs minified variable names. Save
acknowledgements, edit revisions, and keyboard visibility live in the upstream
WASM host integration. Theme and dialog helpers are shared with the native viewer.

## Prerequisites

Install this repository's dependencies with `npm ci`. In the csvzall checkout,
install `src/viewer_wasm/web` dependencies with `npm install` and build the WASM core
using its documented Emscripten build workflow. The web build expects
`out/build/wasm/csvzall_viewer_wasm.js` and `csvzall_viewer_wasm.wasm`.
Rebuild that core whenever its C++ inputs change; this refresh command rebuilds
the web application using those existing core artifacts.

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
adding compatibility string replacements. Stylesheet inlining and compact host
CSS remain packaging concerns; neither changes JavaScript behavior.

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
