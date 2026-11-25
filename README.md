# csvzall for Obsidian
[![Unit Tests](https://github.com/vincentlaucsb/obsidian-csvzall/actions/workflows/unit-tests.yml/badge.svg)](https://github.com/vincentlaucsb/obsidian-csvzall/actions/workflows/unit-tests.yml) [![codecov](https://codecov.io/gh/vincentlaucsb/obsidian-csvzall/graph/badge.svg?token=AACQ2YC6PJ)](https://codecov.io/gh/vincentlaucsb/obsidian-csvzall)

<img src="https://raw.githubusercontent.com/vincentlaucsb/csvzall/refs/heads/master/assets/csvzall-logo-theme-safe.png" alt="csvzall logo: a reciprocating saw cutting through a spreadsheet" width="760">

Open, edit, create, and chart CSV/TSV files directly inside Obsidian.

Ever wanted to treat CSV files as a virtual SQL database, and export the query results to your notes? You can do that too.

This plugin automatically includes a pinned version of the [csvzall](https://github.com/vincentlaucsb/csvzall) helper. It is a C++ app compiled for your specific operating system and CPU, giving you a lightning fast editing and viewing experience, even on files that are hundreds of megabytes big.

If csvzall saves you time, please [star this repository](https://github.com/vincentlaucsb/obsidian-csvzall) [![GitHub stars](https://img.shields.io/github/stars/vincentlaucsb/obsidian-csvzall?style=social)](https://github.com/vincentlaucsb/obsidian-csvzall). It helps other Obsidian
users find the plugin and helps me gauge demand for continued development.

## Phones and Tablets
For mobile devices, install
[`csvzall Lite`](https://community.obsidian.md/plugins/csvzall-mobile), a lightweight version for creating, viewing, and editing CSV/TSV files, based on the same code as the desktop version.

## What It Does

- Opens `.csv` and `.tsv` files in an editable table view inside Obsidian.
- Refreshes the table when the file changes elsewhere and shows when those changes loaded. If you have edits in progress, the viewer keeps them open.
- Turn on **AutoSave** in a pane to save after editing. Plugin settings let you start with it on, start with it off, or hide the switch.
- Opens JSON in the native csvzall editor on desktop and a helper-free editor in Lite, both with syntax highlighting. Compact JSON expands for reading and saves compactly after edits.
  To keep another viewer as your default, turn off **Use csvzall as the default JSON viewer** and reload Obsidian. Choose **Open in csvzall** from a JSON file’s menu whenever you want to use this editor.
- Adds command palette and context-menu actions to create and open CSV/TSV files and configure, refresh, or delete exports.
- Generates exports that update automatically when the source file changes:
  - Bar, line, and heatmap charts.
  - Markdown tables from the entire file, selected columns, or SQLite query results, inserted into notes or saved as standalone notes.
  - Inline values from single-cell SQLite query results, inserted directly into a sentence.
- Write SQL exports in `csvzall` or `sql csvzall` code blocks, or keep using comment markers. Results are saved as ordinary Markdown. [SQL export guide](docs/markdown-tables.md).
- Reformat non-standard CSV files to standard RFC 4180 dialect *with user approval*
  - By default, we respect the existing format of the CSV/TSV file when saving edits

### How does it handle different CSV dialects?
The CSV parsing logic is based on a battle-tested [CSV parsing library](https://github.com/vincentlaucsb/csv-parser), which:
 * Handles arbitrarily large CSV files into the gigabyte range
 * Automatically detects common delimiter and quote character combinations
 * Automatically skips comment and blank lines to find the header
    * By default, a header row is assumed. This can be turned off on a file by file basis.

When a data row has more fields than the first row, the viewer automatically disables headers and shows the first row as data so every value remains visible. CSV options explains how to fix the mismatch.

## Requirements

- Obsidian desktop (use [`csvzall Lite`](https://community.obsidian.md/plugins/csvzall-mobile) on mobile devices)
- Windows x64, macOS Apple Silicon, or Linux x64 for the bundled helper.
  Other desktop architectures require a compatible custom executable.

The included helper is verified with SHA-256 and extracted into the plugin's
directory automatically. Update the plugin through Obsidian to receive helper
updates. You can set a **Custom executable path** to use an independently managed
helper, including a command on PATH. Choose **Use bundled helper** to switch back.

To use CSV data with Obsidian Copilot, Claude Code, or Codex, choose **Enable or
repair** under **Agent integration** in settings. This installs local skills
that locate the bundled helper without adding csvzall to PATH. See the
[agent setup guide](docs/agent-integration.md) for setup and tested compatibility.

## Privacy and Network Use

The plugin does not collect telemetry and works entirely offline. It uses direct filesystem access to install and run the bundled helper, or a custom helper you configure outside your vault.

## Limitations

- Multi-value graphs configured through Obsidian are limited to two value
  columns.

### For Obsidian Sync Standard Users
- The desktop plugin's `main.js` exceeds 5 MB because it includes the offline
  helpers for all supported platforms. Obsidian Sync Standard cannot sync this
  file; install the plugin separately on each desktop.

## Manage exports

- Run **Open exports**, or select **Configure** under **Exports** in the plugin settings.
- Use **Configure** beside a CSV/TSV file to manage its chart, table, and value exports, including paused exports.
- In the CSV viewer, run a SQLite query and choose **Insert into note** to select a note anywhere in the vault. **Keep updated** can be unchecked to pause automatic updates while retaining manual refresh.
- **Delete** removes export configurations and stops their automatic updates. Your source files and generated content are kept.
- Unused SQL export configurations are removed automatically when their last note reference is removed. Chart configurations remain available until you delete them.
- With Obsidian Sync, enable **Installed community plugins** to sync export configurations and **Sync all other types** for CSV/TSV sources. The plugin restores its local `.csvzall` configurations on each device.
