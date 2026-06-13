# csvzall for Obsidian
[![Unit Tests](https://github.com/vincentlaucsb/obsidian-csvzall/actions/workflows/unit-tests.yml/badge.svg)](https://github.com/vincentlaucsb/obsidian-csvzall/actions/workflows/unit-tests.yml) [![codecov](https://codecov.io/gh/vincentlaucsb/obsidian-csvzall/graph/badge.svg?token=AACQ2YC6PJ)](https://codecov.io/gh/vincentlaucsb/obsidian-csvzall)

<img src="https://raw.githubusercontent.com/vincentlaucsb/csvzall/refs/heads/master/assets/csvzall-logo-theme-safe.png" alt="csvzall logo: a reciprocating saw cutting through a spreadsheet" width="760">

Open, edit, create, and chart CSV files directly inside Obsidian.

This plugin relies on the [csvzall](https://github.com/vincentlaucsb/csvzall) command line application, which can be downloaded through the plugin via GitHub Releases.

## What It Does

- Opens `.csv` files in an editable table view inside Obsidian.
- Adds a **New CSV** action to folder context menus.
- Adds an **Open with csvzall** action to CSV file menus.
- Can generate bar, line, and heatmap charts.
- Can regenerate configured charts when CSV files change.
- Can run SQLite queries over CSV files.
- Supports generated Markdown table notes from chart config entries.

## Requirements

- Obsidian desktop. Mobile is not supported.
- A local filesystem vault.
- The `csvzall` helper binary. The plugin can download this for you from its
  settings tab, or from the missing-binary screen when opening a CSV.

Downloaded binaries are verified with SHA-256 before they are installed under
the plugin-managed directory.

## Privacy and Network Use

The plugin does not collect telemetry. It contacts GitHub Releases only when
you choose to install or update the managed `csvzall` helper. CSV viewing and
charting run through the local helper process on your machine.

## Limitations

- Currently CSVs larger than 200MB are read-only and not editable. This is to prevent materializing large CSVs entirely in memory.
- Multi-value graphs configured through Obsidian are limited to two value columns.

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
