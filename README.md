# csvzall for Obsidian

<img src="https://raw.githubusercontent.com/vincentlaucsb/csvzall/refs/heads/master/assets/csvzall-logo.png" alt="csvzall logo: a reciprocating saw cutting through a spreadsheet" width="760">

Open, edit, create, and chart CSV files directly inside Obsidian.

This plugin connects Obsidian to the local `csvzall` desktop helper. When you
open a `.csv` file, csvzall starts a local viewer and the plugin embeds it in an
Obsidian pane. Edits are saved by the helper process.

## What It Does

- Opens `.csv` files in an editable table view inside Obsidian.
- Adds a **New CSV** action to folder context menus.
- Adds an **Open with csvzall** action to CSV file menus.
- Can install or update the matching `csvzall` binary from GitHub Releases.
- Can regenerate configured charts when CSV files change.
- Supports generated Markdown table notes from chart config entries.

## Requirements

- Obsidian desktop. Mobile is not supported.
- A local filesystem vault.
- The `csvzall` helper binary. The plugin can download this for you from its
  settings tab, or from the missing-binary screen when opening a CSV.

Downloaded binaries are verified with SHA-256 before they are installed under
the plugin-managed directory.

## Chart Automation

Create `.csvzall/charts.json` in your vault, or inside a folder, to define chart
jobs. Entries with `runOnSave: true` are regenerated after their input CSV is
saved.

Besides chart image outputs, `type: "markdown-table"` can write generated
Markdown notes that you embed with Obsidian's `![[path/to/output]]` syntax.

## Development

```powershell
npm install
npm run dev
npm test
```

For local testing, copy or link this folder to:

```text
<Vault>/.obsidian/plugins/csvzall/
```

Then reload Obsidian and enable the plugin.

Release builds should include:

- `manifest.json`
- `main.js`
- `styles.css`
