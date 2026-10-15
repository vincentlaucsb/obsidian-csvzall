# csvzall for Obsidian
[![Unit Tests](https://github.com/vincentlaucsb/obsidian-csvzall/actions/workflows/unit-tests.yml/badge.svg)](https://github.com/vincentlaucsb/obsidian-csvzall/actions/workflows/unit-tests.yml) [![codecov](https://codecov.io/gh/vincentlaucsb/obsidian-csvzall/graph/badge.svg?token=AACQ2YC6PJ)](https://codecov.io/gh/vincentlaucsb/obsidian-csvzall)

<img src="https://raw.githubusercontent.com/vincentlaucsb/csvzall/refs/heads/master/assets/csvzall-logo-theme-safe.png" alt="csvzall logo: a reciprocating saw cutting through a spreadsheet" width="760">

Open, edit, create, and chart CSV files directly inside Obsidian.

This plugin relies on the [csvzall](https://github.com/vincentlaucsb/csvzall) command line application, which can be downloaded through the plugin via GitHub Releases.

On phones and tablets, install
[`csvzall Mobile`](https://community.obsidian.md/plugins/csvzall-mobile).

If csvzall saves you time, please star this repository. It helps other Obsidian
users find the plugin and helps me gauge demand for continued development.

## What It Does

- Opens `.csv` files in an editable table view inside Obsidian.
- Adds a **New CSV** action to folder context menus.
- Adds an **Open with csvzall** action to CSV file menus.
- Can generate bar, line, and heatmap charts.
- Can regenerate configured charts when CSV files change.
- Can run SQLite queries over CSV files.
- Supports generated Markdown table notes from chart config entries.

## Requirements

- Obsidian desktop.
- A local filesystem vault.
- The `csvzall` helper binary. The plugin can download this for you from its
  settings tab, or from the missing-binary screen when opening a CSV.

For mobile creating, viewing, and editing, install the generated
[`csvzall Mobile`](https://community.obsidian.md/plugins/csvzall-mobile)
plugin instead. The mobile plugin uses the bundled WASM viewer and does not
install or run the desktop helper binary.

Downloaded binaries are verified with SHA-256 before they are installed under
the plugin-managed directory.

## Privacy and Network Use

The plugin does not collect telemetry. It contacts GitHub Releases only when
you choose to install or update the managed `csvzall` helper. CSV viewing and
charting run through the local helper process on your machine.

## Limitations

- This package is desktop-only. Use
  [`csvzall Mobile`](https://community.obsidian.md/plugins/csvzall-mobile)
  for mobile CSV creating, viewing, and editing.
- Desktop CSV viewing and editing require a local filesystem vault so the
  plugin can launch the local `csvzall` helper process against real file paths.
- Save desktop edits before renaming or moving a CSV. If a file moves with
  unsaved edits, the editor pauses until you restore its original path or
  choose to discard the edits and reopen it.
- In the mobile companion plugin, chart generation, SQLite queries, and helper
  binary management are not available.
- Multi-value graphs configured through Obsidian are limited to two value
  columns.

## Chart Automation

Create `.csvzall/charts.json` in your vault, or inside a folder, to define chart
jobs. Entries with `runOnSave: true` are regenerated after their input CSV is
saved.

Besides chart image outputs, `type: "markdown-table"` can write generated
Markdown notes that you embed with Obsidian's `![[path/to/output]]` syntax.

## CSV exports in notes

While editing a note, run **Insert from CSV**, or choose it from the
editor context menu. Pick a CSV from your vault, then include the entire CSV,
select columns, or enter a SQLite query against table `data`. **Preview** shows
up to 20 rows; inserting a table includes the full result. Choose **Insert as: Value** to insert
a single query result directly into a sentence. Value queries must return exactly
one row and one column; text is escaped for Markdown and line breaks become spaces.

**Keep updated when CSV changes** is enabled by default. The note contains an
ordinary Markdown table or inline text with short ID markers in hidden HTML
comments. Sources and queries are saved in `.csvzall/exports.json`, alongside
chart definitions. Existing table definitions and markers migrate automatically;
the original `tables.json` is retained as a backup.
CSV saves refresh the table while the desktop plugin is running; enabling the
plugin also refreshes saved tables. Text outside the table is preserved. If a
source is missing or a query fails, the previous table is kept.

Place the cursor inside a generated table to edit its source or query, refresh
it, open its source, or stop automatic updates using the command palette or
editor context menu. Stopping updates leaves a normal editable Markdown table.
Changes made directly to a linked table may be replaced on its next refresh.

You can also right-click a CSV and choose **Export to Markdown note** to create
a new note. Generated tables remain readable when the plugin is disabled.
Generation and automatic refresh require the desktop plugin and csvzall helper;
the mobile companion can display the saved notes.

## Development

```powershell
npm install
npm run dev
npm test
```

To refresh the packaged WASM viewer from a local `csvzall` checkout:

```powershell
npm run sync:wasm-viewer
npm run check:wasm-viewer
```

The sync script copies `..\csvzall\src\viewer_wasm\web\dist` into
`wasm-viewer/` and writes provenance metadata. Treat `wasm-viewer/` like a
generated release asset: commit it, but do not edit it by hand.

The desktop release workflow publishes Obsidian's standard plugin assets:
`manifest.json`, `main.js`, and `styles.css`.

Maintainer notes for the generated mobile distribution live in
[`docs/mobile-distribution.md`](docs/mobile-distribution.md).

For local testing, copy or link this folder to:

```text
<Vault>/.obsidian/plugins/csvzall/
```

Then reload Obsidian and enable the plugin.
