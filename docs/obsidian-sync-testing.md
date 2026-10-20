# Testing export reflection with Obsidian Sync

Release 0.8.0 is being prepared with three-platform helpers from the published
csvzall 0.8.0 source. See the [release log](obsidian-sync-release.md) for current
status. The Windows development procedure below records the earlier device test;
it is not the production release artifact.

The desktop plugin and sibling csvzall checkout have local changes on `master`.
The plugin keeps CLI configurations under `.csvzall/` and reflects them into
standard plugin `data.json`. Changes are observed on startup, after plugin
mutations, on incoming settings changes, and by the ten-second polling fallback.

## Windows test bundle

For the current desktop/laptop Sync test, use the self-contained Windows x64
development package at `.test-build/windows-sync-direct-folders.zip`. Its contents
are also in `.test-build/windows-sync-direct-folders/`.

Copy its `main.js`, `manifest.json`, and `styles.css` into the affected vault's
active configuration folder under `plugins/csvzall/`, preserving `data.json`.
Reload csvzall on each device. If a device previously selected a custom executable,
choose **Use bundled helper**. No separate executable transfer or path is needed.
Obsidian may transport these plugin files, but a running plugin still needs to
reload; compare `main.js` against the package's `SHA256SUMS` when uncertain.

This build automatically migrates inherited configs so each folder owns its
direct CSVs and export notes. Charts live beside their source CSV; SQL definitions
live beside referencing notes, with local copies for notes in different folders.
Source files and generated content stay in place. The export Sync descriptor is
now schema 2; earlier test builds cannot read it. Update and reload every test
device before editing exports there.

The package embeds only the compatible Windows helper, from the existing 0.8.0
source baseline plus `--obsidian`. Its helper version still reads 0.8.0, and its
plugin version still reads 0.7.1. Those numbers alone cannot distinguish this
development build: its manifest has `csvzallDevelopmentBuild`, its bundle has a
Windows test banner, and the package records exact checksums. Other platforms are
intentionally unsupported in this development package.

The local `Vince's Notebook` vault was updated and verified in **bundled** mode:
the CSV viewer opened, export reflection was ready with no pending scopes, and
the session had no SQL/reflection errors. Its `data.json` contains the three SQL
exports and nine charts. The three SQL definitions moved automatically from the
root config into Bike (two) and Exercise (one), beside their notes. The root SQL
config is empty. Repeated polling kept revisions stable; Sync reported synced.
The laptop passed the previous bundle's Sync reconstruction test; its new
direct-folder migration must still be verified there.

To package another compatible development executable:

```powershell
node scripts/build-windows-sync-test.mjs .test-build/native-sync-development/build/csvzall.exe .test-build/new-windows-sync-test
```

Use a new output directory. The builder runs the type/lint gate, validates native
Obsidian mode and save behavior, and exercises actual bundled installation and
process startup. Its development identity labels source inputs as declarations,
not release attestations. Production pins and archives stay unchanged; root
production builds still contain the old helper snapshot and require full release
preparation before distribution. Release validation rejects the test manifest.

## Alternative: select a development helper

The updated native helper understands `view --obsidian`. The committed bundled
helper snapshot predates this flag. This alternative uses a custom executable;
publishing new bundled archives remains a release-preparation step.
The plugin checks flag support and the startup acknowledgment rather than
silently falling back to an older helper's automatic chart generation.

The rebuilt Windows executable in this workspace is:

```text
E:\GitHub\obsidian-csvzall\.test-build\native-sync-development\build\csvzall.exe
```

After building the desktop plugin, prepare the canonical local test vault:

```powershell
node scripts/setup-demo-vault.mjs --binary E:/GitHub/obsidian-csvzall/.test-build/native-sync-development/build/csvzall.exe
```

Open `demo-vault/` in Obsidian and reload the plugin. If this device already has
new-format local executable preferences, choose that executable under **Custom
executable path** in plugin settings; an existing device preference takes priority
over a legacy path written to `data.json` by the setup script. The setup script
preserves other vault settings and links the checkout's build artifacts.

For another vault or laptop, install the updated `main.js`, `manifest.json`, and
`styles.css` through the normal manual development-install procedure, preserving
its existing `data.json`. Place the rebuilt helper at a local path and select it
in plugin settings on that device too. Executable selection and installation
metadata now live in Obsidian's device-local storage, scoped to the active config
profile. A path selected on one device will not overwrite another's helper path.
Use a helper built for that machine's operating system and architecture.

## Two-device Sync checks

1. On both devices, enable **Installed community plugins** under Sync's vault
   configuration controls for plugin data, and **Sync all other types** for
   CSV/TSV sources. Check relevant excluded folders. The plugin settings show
   these statuses when the available Sync interface can be inspected; unknown
   inspection does not mean the setting is disabled.
2. Start on the device containing the original `.csvzall/charts.json` and SQL
   export definitions. Back them up before testing automatic migration. After
   loading, verify direct-folder configs and inspect the standard
   plugin `data.json` for `csvzallExportSync` and independently keyed revision
   records. Do not expect short note markers alone to reconstruct missing queries.
3. Use a receiving test vault that does not have a `.csvzall` folder. After its
   `data.json` arrives, confirm the plugin creates the hidden folder and JSON
   configurations. Nested scopes wait for their enclosing vault folder to arrive.
   Generate a chart and refresh an SQL table/value using the ordinary commands.
4. Change different definitions on the two devices; both edits should survive.
   Change the same definition offline; after Sync resumes, the recorded newest
   revision wins. Reflection itself must not keep advancing edit timestamps.
5. Delete an export explicitly and reconnect a device with an old local config.
   The deleted export must stay deleted. Recreate it deliberately afterward and
   confirm the new edit can win.
6. Remove the final SQL marker from a readable note and let Sync settle. The
   linked SQL definition should be cleaned up. A note arriving late can recover
   automatic stale cleanup, but not an explicit deletion. An unrelated ancestor
   definition with the same ID must not take over the late note.
7. Delete a generated chart output in the disposable test vault. Its chart
   definition should remain available for regeneration.
8. Rename a folder/source/note, including after an unpolled CLI config edit.
   Definitions and relative paths should retain their meaning, and old scope
   configs should not be recreated. A malformed unrelated config should not stop
   the valid move.
9. Temporarily make a config malformed or unavailable in a disposable fixture.
   Existing generated content should remain, repeated background attempts should
   stop producing duplicate notices, and unrelated scopes should remain usable.
   Correct the config and verify recovery. Explicit retry actions still report
   their result.
10. Copy a migrated subfolder with its files and local `.csvzall/` into a fresh
    test vault without its old ancestors. Confirm its CSV charts and note exports
    work. Runtime lookup must not require an ancestor config.

CLI edits made while the plugin is disabled are imported at its next startup.
The standalone CLI does not read `data.json`; the plugin must first reconstruct
its ordinary JSON configurations. Intentionally separate configuration profiles
remain separate.

## Automated validation and review

The implementation has deterministic two-device tests covering reflection,
newest-wins ordering, deletion history, journal-loss recovery, rename preservation,
per-scope failures, settings races, device-local helpers, SQL scope recovery,
session suppression, and viewer cancellation/acknowledgment. Native tests cover
standalone automatic charts, host-owned automation, and explicit chart actions.

Run `npm test`, `npm run check:source-archive`, the native C++ suite, and the CLI
smoke tests. The production desktop/mobile builds include the required type and
lint gates. Review findings, regressions, and validation results are recorded in
the [implementation log](obsidian-sync-implementation.md).

Actual two-device Obsidian Sync transport is a manual acceptance check. Simulated
device convergence and native localhost tests do not substitute for it. No remote
Sync vault or Sync settings are created or changed by this implementation work.
