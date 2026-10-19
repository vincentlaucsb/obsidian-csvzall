# csvzall for Obsidian
[![Unit Tests](https://github.com/vincentlaucsb/obsidian-csvzall/actions/workflows/unit-tests.yml/badge.svg)](https://github.com/vincentlaucsb/obsidian-csvzall/actions/workflows/unit-tests.yml) [![codecov](https://codecov.io/gh/vincentlaucsb/obsidian-csvzall/graph/badge.svg?token=AACQ2YC6PJ)](https://codecov.io/gh/vincentlaucsb/obsidian-csvzall)

<img src="https://raw.githubusercontent.com/vincentlaucsb/csvzall/refs/heads/master/assets/csvzall-logo-theme-safe.png" alt="csvzall logo: a reciprocating saw cutting through a spreadsheet" width="760">

Open, edit, create, and chart CSV files directly inside Obsidian. Tab-separated `.tsv` files are also supported.

This plugin includes a pinned version of the [csvzall](https://github.com/vincentlaucsb/csvzall) helper. It is ready to use offline and updates together with the plugin.

On phones and tablets, install
[`csvzall Mobile`](https://community.obsidian.md/plugins/csvzall-mobile).

If csvzall saves you time, please star this repository. It helps other Obsidian
users find the plugin and helps me gauge demand for continued development.

## What It Does

- Opens `.csv` and `.tsv` files in an editable table view inside Obsidian.
- Adds a **New CSV** action to folder context menus.
- Adds an **Open with csvzall** action to CSV file menus.
- Can generate bar, line, and heatmap charts.
- Can regenerate configured charts when CSV files change.
- Can run SQLite queries over CSV files.
- Supports generated Markdown table notes from chart config entries.

## Requirements

- Obsidian desktop.
- A local filesystem vault.
- Windows x64, macOS Apple Silicon, or Linux x64 for the bundled helper.
  Other desktop architectures require a compatible custom executable.

For mobile creating, viewing, and editing, install the generated
[`csvzall Mobile`](https://community.obsidian.md/plugins/csvzall-mobile)
plugin instead. The mobile plugin uses the bundled WASM viewer and does not
install or run the desktop helper binary.

The included helper is verified with SHA-256 and extracted into the plugin's
directory automatically. Update the plugin through Obsidian to receive helper
updates. You can set a **Custom executable path** to use an independently managed
helper, including a command on PATH. Choose **Use bundled helper** to switch back.

## Privacy and Network Use

The plugin does not collect telemetry or contact GitHub to install or update
the helper. CSV viewing and charting run through the local helper process on
your machine.

The desktop plugin uses direct filesystem access to install the helper and
pass real file paths to it. It can execute a helper outside your vault when
you configure its path or use an executable on your system PATH. This access
is required for the native viewer, editing, charts, and SQL. Helper processes
run with your user account's filesystem permissions.
Configured chart paths can also direct the helper to read inputs or write
outputs outside the vault.

## Limitations

- The desktop plugin's `main.js` exceeds 5 MB because it includes the offline
  helpers for all supported platforms. Obsidian Sync Standard cannot sync this
  file; install the plugin separately on each desktop.
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

## Manage exports

The plugin's settings show how many exports are saved. Select **Configure**
under **Exports**, or run the **Open exports** command, to open the exports tab.
It lists CSV files with saved chart, table, or value export configurations,
including paused exports; use **Refresh** after editing configuration files
directly. **Configure** lists each chart, SQL table, or value export with
**Configure** and **Delete** actions, including files with only one export.
A SQL table or value export's options show the note that contains it, with a
**Go to note** button. Deleting an individual export
removes only its configuration and keeps the CSV and generated content.
Linked note regions become ordinary Markdown when their export is deleted.
The **Delete** action beside the CSV removes all of that file's export
configurations while preserving the CSV and generated content. Linked note
regions become ordinary Markdown.
