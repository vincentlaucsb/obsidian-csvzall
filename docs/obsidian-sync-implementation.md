# Export Sync implementation and validation

The following records the development and Windows acceptance stages. The
[release log](obsidian-sync-release.md) tracks the subsequently authorized 0.8.0
release and replaces the development-only packaging boundary once preparation
passes.

Implemented locally on 2026-10-19 on `master` in obsidian-csvzall and csvzall.
Both branches were pulled before implementation. The plugin repository's local
`master` tracks `origin/main`; upstream csvzall's tracks `origin/master`.

## Result

- `ExportReflection` imports existing root and nested CLI configurations into
  independently keyed immutable revisions in standard plugin `data.json`.
  Receiving devices reconstruct missing `.csvzall/charts.json` and `exports.json`
  before export consumers run. The CLI continues to use its existing JSON files.
- Per-export timestamps, deterministic ties, and deletion tombstones implement
  newest-wins resolution. Original bytes, unknown fields, pending moves, and
  observed revisions are retained. Failed or incomplete scopes keep their previous
  output without blocking unrelated scopes. Reflected writes do not become edits.
- A device-local journal records reconciliation and migration state. Executable
  paths and helper installation metadata also remain local to each device and
  active configuration profile; incoming settings cannot replace them.
- SQL stale cleanup waits for usable reference evidence and idle Sync. Late notes
  can recover automatic cleanup, while explicit deletion remains authoritative.
  Missing generated chart output never deletes its chart configuration.
- Background errors are deduplicated for the plugin session, including recurrence
  after an intervening success. Explicit retry commands still report results.
  Settings distinguish plugin-data syncing from CSV/TSV syncing, with guarded
  read-only inspection and an unknown status when inspection is unavailable.
- The plugin launches `view --obsidian` after checking support and validates the
  startup acknowledgment. The flag disables native save-triggered chart
  automation so the plugin owns it. Standalone saves and explicit chart actions
  retain their existing behavior. csvzall does not discover vaults or profiles.

See the [design](obsidian-sync-export-plan.md) for the schema and mode contract,
and the [testing guide](obsidian-sync-testing.md) for installation and acceptance.

## Review

An independent code-review subagent reviewed both repositories repeatedly.
Findings were fixed before the next pass, with regressions covering:

- Historical config resurrection after local journal loss and revisions arriving
  between plugin-data reads.
- Device-specific helper preferences being overwritten by incoming settings.
- Folder moves with unobserved CLI edits, incomplete materialization, changed
  scope depth, retry receipts, and subsequent manual corrections.
- Late nested SQL references resolving to an unrelated ancestor with the same ID.
- Incomplete Sync cleanup, per-scope write failures, and readiness changes between
  generation preflight and replacement of existing content.
- Truncated viewer acknowledgments, panes closing during capability probes, and
  manual retry feedback after background suppression.

The final review reported no remaining actionable P0/P1/P2 findings and
independently reran 78 targeted reflection, process, and SQL tests successfully.

## Validation

- `npm test`: 266 desktop/unit/pipeline tests and 14 mobile tests passed. Desktop
  and mobile production builds passed their required type/lint and packaging gates.
- Native C++ suite: 1,606 assertions across 207 test cases passed; the focused
  viewer run passed 422 assertions across 31 cases.
- Native CLI smoke test passed, including `view --obsidian` help coverage.
- Upstream version consistency check passed at its existing version, 0.7.0.
- LF normalization changed zero files; diff whitespace checks passed.
- A clean source archive built successfully after `npm ci`, without `.git` or
  inherited `node_modules`.

Native localhost and plugin fixture tests require execution outside the restricted
sandbox. The sandbox failures were rerun successfully with that access.

## Local testing and release boundary

The self-contained Windows development package is
`.test-build/windows-sync-direct-folders.zip`. It embeds the existing 0.8.0 source
baseline plus the Obsidian-mode patch, built with pinned dependencies and the
static Obsidian build options. The native runtime-library guard passed. Source
inputs are explicitly declared development inputs, not release provenance.

The package passed real native hosted-save/explicit-generation checks and an
integration run through `InstallerService` and `CsvzallProcessService` in bundled
mode. The local `Vince's Notebook` was updated with these three plugin files,
preserving `data.json`, and verified with a working CSV viewer, no pending
reflection, and zero SQL/reflection errors. Three SQL exports and nine charts were
reflected. Both required Sync switches were enabled and Sync reported synced.

The follow-up packaging review found no remaining priority findings and verified
the actual embedded Windows archive, executable and transfer ZIP checksums. Ten
helper-pipeline tests passed, including exact mode acknowledgment and rejection of
development manifests by release validation. Fresh and cached native preparation
now exercise `--obsidian`, CSV save automation ownership and explicit generation.

Committed bundled helper archives and their provenance pins remain unchanged.
They predate the flag; prepare new platform archives through the existing release
workflow before distributing a release. Use the Windows development package for
this test; root production builds retain the old snapshot. No commits, tags,
pushes, or publication were performed.

The user confirmed that the preceding Windows bundle reconstructed configs on
the laptop immediately and stopped the errors. The new direct-folder migration
still needs its laptop acceptance check.
No remote Sync vault, credentials, or Sync preferences were modified.

## Automatic direct-folder migration

Implemented the [direct-folder decision](direct-folder-export-plan.md): chart
configs belong beside source CSVs, SQL configs beside referencing notes. Runtime
lookup is local-only. The plugin prepares a direct chart config before launching
the native viewer; standalone csvzall lookup remains unchanged.

Migration freezes old reference bindings, rebases paths, preserves edit times and
unknown fields, and verifies destinations before retiring inherited entries.
Relocation lineage supports delayed notes and folder moves; explicit deletion
remains authoritative. Incomplete note scans defer SQL localization and cleanup
without blocking chart work. Shared definitions become local copies as needed.
The descriptor uses schema 2 so older test builds stop safely instead of modifying
relocation history they do not understand.

Review findings were fixed with regressions for transitive SQL moves, ambiguous
legacy aliases, staged notes, locale-independent ordering, incomplete scans,
viewer cancellation during config preparation, late references in the original
folder, and edited notes moving back there. The final independent review reported
no actionable P0/P1/P2 findings and passed all 99 focused tests. Full tests,
source-archive build, and the Windows artifact's native/bundled checks passed.

The local Notebook was backed up under
`.test-build/notebook-before-direct-folders-20261019-224640/` before installation.
Its root SQL config now has no entries; Bike owns two SQL definitions and Exercise
owns one. All nine charts remain available. The live viewer opened Coding/Test.csv
with `--obsidian`, no SQL/reflection errors or pending scopes appeared, Sync
reported synced, and 26 reflected revisions remained stable across polling.
The installed bundle SHA-256 is
`3fee9557f52e945962212669ad175634a075452bf344c0e89ccd2b7dc10d0d5b`.
