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

`scripts/vendor/host-theme.mjs` is a verbatim snapshot of csvzall's
[`src/viewer/modules/host-theme.mjs` at 903f2d1](https://github.com/vincentlaucsb/csvzall/blob/903f2d1/src/viewer/modules/host-theme.mjs). The asset patch step copies this source
module into older WASM bundles and adds its module script to the HTML; it does
not patch the minified bundle to implement the protocol. New WASM bundles that
already contain `theme-ready` use their built-in receiver instead. Keep this
snapshot synchronized with upstream until all packaged builds include it.

`scripts/vendor/dialog-dismiss.mjs` similarly vendors the shared viewer dialog
helper from `src/viewer/modules/dialog-dismiss.mjs`. Ordinary dialog backdrops
cancel the dialog when a primary pointer press and click both occur outside its
bounds. Content clicks and drags starting inside do not dismiss it. Closing uses
the cancel/close lifecycle, so the unsaved-changes prompt resolves as Cancel.
Progress dialogs remain controlled by the operation that opened them.

The refreshed WASM bundle includes Popright 0.1.2 from the upstream vendored npm
package. Its dropdown trigger handling preserves the pointer/focus events until
the closing click, preventing an already-open menu from immediately reopening.
Theme and dialog helpers are now built into this bundle; separate module copies
are only added when patching older bundles. The save-acknowledgement and keyboard
lifecycle adapters are validated against the refreshed minified bundle.

The bridge transfers theme values, not Obsidian's stylesheets or font files.
Custom themes and snippets that set these variables are supported. Arbitrary
selectors targeting Obsidian components and document-local web fonts are not
reproduced in the iframe. No theme files are written to the vault, and no CLI
restart, CSV reload, grid recreation, or keyboard-driven resizing is involved.

Manual verification: use opposite OS/Obsidian modes, change accent and theme
with two CSV panes open, reload a pane, and repeat in a popout and on mobile.
Verify toolbar, grid, menus, inputs, and dialogs; keep an unsaved edited cell
open during a color change and confirm that its value and focus survive.
