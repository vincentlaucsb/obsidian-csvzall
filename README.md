# csvzall for Obsidian
[![Unit Tests](https://github.com/vincentlaucsb/obsidian-csvzall/actions/workflows/unit-tests.yml/badge.svg)](https://github.com/vincentlaucsb/obsidian-csvzall/actions/workflows/unit-tests.yml) [![codecov](https://codecov.io/gh/vincentlaucsb/obsidian-csvzall/graph/badge.svg?token=AACQ2YC6PJ)](https://codecov.io/gh/vincentlaucsb/obsidian-csvzall)

<img src="https://raw.githubusercontent.com/vincentlaucsb/csvzall/refs/heads/master/assets/csvzall-logo-theme-safe.png" alt="csvzall logo: a reciprocating saw cutting through a spreadsheet" width="760">

Open, edit, create, and chart CSV files directly inside Obsidian.

This plugin relies on the [csvzall](https://github.com/vincentlaucsb/csvzall) command line application, which can be downloaded through the plugin via GitHub Releases.

On phones and tablets, install
[`csvzall Mobile`](https://github.com/vincentlaucsb/obsidian-csvzall-mobile)
instead. It uses the bundled WASM viewer for basic mobile CSV viewing and
editing without the desktop helper binary.

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

For mobile viewing and editing, install the generated
[`csvzall Mobile`](https://github.com/vincentlaucsb/obsidian-csvzall-mobile)
plugin instead. The mobile plugin uses the bundled WASM viewer and does not
install or run the desktop helper binary.

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

To build the generated mobile-only distribution:

```powershell
npm run test:mobile
npm run sync:mobile-repo
```

The mobile distribution is generated into `.mobile-dist/` and synced to the
sibling `obsidian-csvzall-mobile` repository. Its `main.js` embeds the
`wasm-viewer/` assets and materializes them into the plugin folder at runtime,
so the mobile release can use Obsidian's standard `main.js`, `manifest.json`,
and `styles.css` asset model. The generated mobile bundle is checked to ensure
that desktop-only Node.js and Electron APIs do not leak into the release, and
that it only registers CSV ownership on Obsidian mobile. Mobile plugin metadata
and versioning come from `mobile-src/manifest.json`, so mobile releases can use
a separate version cadence from desktop releases.

For local testing, copy or link this folder to:

```text
<Vault>/.obsidian/plugins/csvzall/
```

Then reload Obsidian and enable the plugin.
