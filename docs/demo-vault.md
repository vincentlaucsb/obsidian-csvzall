# Canonical local test vault

`demo-vault/` is the shared local Obsidian test bed. It contains the sample CSV,
note, chart configuration, and rendered chart from the original csvzall Demo
vault. The chart is an intentional fixture so the note renders on a clean checkout.
The original external vault is left intact; open this repository's `demo-vault`
folder in Obsidian to use the canonical copy.

## Setup

Build the desktop plugin and link its build files into the demo vault:

```sh
npm run build
node scripts/setup-demo-vault.mjs
```

To select a locally built native viewer at the same time:

```sh
node scripts/setup-demo-vault.mjs --binary /absolute/path/to/csvzall
```

On Windows, use the path to `csvzall.exe`. File symlinks require Developer Mode
or an elevated terminal. The script refuses to replace unrelated files or follow
an existing plugin-directory junction. Rerunning it preserves local settings;
`--binary` changes only the executable selection.

Open `demo-vault` as a vault in Obsidian and enable community plugins. The three
plugin artifacts link to this checkout; its `data.json`, installed binaries,
logs, appearance, workspace, and other Obsidian state stay local and ignored.
Do not link the entire repository as the plugin folder, because that shares
settings with other vaults. Rebuild and reload Obsidian after plugin changes;
close and reopen CSV panes after native viewer changes.

## Manual checks

- Open `Productivity Tracker.csv`; edit and save a cell, then reopen it.
- Switch Obsidian light/dark mode and accent while the viewer is open. Check
  that the grid and menus follow the host and an active edit retains focus.
- Click an open menu trigger again to close it. Switch between menu triggers.
- Click outside ordinary dialogs to cancel; clicking inside or dragging from
  inside to outside must leave them open. Loading dialogs stay open.
- Run the configured chart and open `2026-06-13.md` to inspect the embedded SVG.
- Launch csvzall outside Obsidian and check the system-aware theme fallback.

Fixture edits and the baseline chart are version controlled. Review their diffs
after testing and restore only your temporary changes. New generated charts,
trash, plugin state, and Obsidian workspace files are ignored. Never copy a
real vault's private notes, credentials, or plugin settings into this fixture.
