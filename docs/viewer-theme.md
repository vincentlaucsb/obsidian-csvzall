# Viewer theme synchronization

The plugin sends a versioned `postMessage` to each CSV iframe:

```js
{ source: "obsidian-csvzall", type: "theme", version: 1,
  mode: "dark", variables: { "--background-primary": "#1e1e1e", /* ... */ } }
```

The allowlist in `src/views/viewerTheme.ts` contains the supported Obsidian
variables. Values are read from the view's computed style in its own window.
Updates follow Obsidian's `css-change` event and changes to the document/body
theme classes or inline variables. Notifications are coalesced to one animation
frame and unchanged values are suppressed. Loading/reloading an iframe or its
`{ source: "csvzall-viewer", type: "theme-ready", version: 1 }` handshake forces
a fresh snapshot. Subscriptions are removed when the view replaces the iframe
or closes. The receiver accepts messages only from its parent window.

Desktop requires the [corresponding csvzall viewer receiver](https://github.com/vincentlaucsb/csvzall/pull/15). Older binaries
ignore theme messages and retain their existing appearance. Release the csvzall
change before shipping this integration as a desktop feature. The mobile plugin
includes the receiver, so it does not depend on the installed desktop binary.

The receiver lives in upstream `src/viewer/modules/host-theme.mjs` and is
compiled into both viewers. Use the [source refresh workflow](wasm-viewer-refresh.md)
to update packaged WASM assets. Older bundles without the required source host
integration are rejected; there are no separate compatibility module snapshots.

The shared `src/viewer/modules/dialog-dismiss.mjs` helper is also compiled into
both viewers. Ordinary dialog backdrops
cancel the dialog when a primary pointer press and click both occur outside its
bounds. Content clicks and drags starting inside do not dismiss it. Closing uses
the cancel/close lifecycle, so the unsaved-changes prompt resolves as Cancel.
Progress dialogs remain controlled by the operation that opened them.

The refreshed WASM bundle includes Popright 0.1.2 from the upstream vendored npm
package. Its dropdown trigger handling preserves the pointer/focus events until
the closing click, preventing an already-open menu from immediately reopening.
Theme, dialog, save-acknowledgement, and keyboard lifecycle behavior all come
from upstream source and source-level tests. Packaging leaves the compiled
JavaScript unchanged and validates its capabilities and imported digest.

The bridge transfers theme values, not Obsidian's stylesheets or font files.
Custom themes and snippets that set these variables are supported. Arbitrary
selectors targeting Obsidian components and document-local web fonts are not
reproduced in the iframe. No theme files are written to the vault, and no CLI
restart, CSV reload, grid recreation, or keyboard-driven resizing is involved.

Manual verification: use opposite OS/Obsidian modes, change accent and theme
with two CSV panes open, reload a pane, and repeat in a popout and on mobile.
Verify toolbar, grid, menus, inputs, and dialogs; keep an unsaved edited cell
open during a color change and confirm that its value and focus survive.
