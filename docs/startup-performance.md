# CSV viewer startup preparation

Opening a native viewer prepares its chart configuration separately from global
export reconciliation. The scoped pass reads chart configurations along the
CSV's ancestor chain and follows their destination/relocation dependencies. It
does not enumerate vault folders or discover SQL references in Markdown notes.
This retains automatic localization of inherited charts, destination collision
checks, verified writes, incoming revisions and deletion ordering. Pending
renames and an already-running reconciliation are still awaited.

`CsvService` owns this preparation before launching a viewer. The process service
does not repeat global reconciliation on launch or for `view --help`. Export
commands retain their preflight reconciliation and post-preflight scope guards.

Global discovery still runs on initialization, settings arrivals, explicit export
mutations and background polling. `MarkdownTableService` caches successfully
parsed closed notes by file identity, path, modification time and size. Note
events invalidate the cache even when timestamps and sizes match; renames clear
it. Open editing buffers are always parsed directly. Failed reads/parses are not
cached, and mutations during a reference scan mark the scan incomplete. Cleanup
retains its Sync, missing-note and concurrent-edit safeguards.

## Preparation benchmark, October 20, 2026

A one-off local diagnostic compared release commit `95bfff0` with the working
tree. It used the same 1,000 Markdown notes (about 1.3 KB each) on disk, 102
indexed folder scopes, an existing direct chart configuration and an in-memory
configuration adapter. Each global reference pass read and parsed all notes
with CommonMark. Initialization finished before timing started.

The baseline replayed `prepareViewer`, the launch preflight and, on first open,
the capability-probe preflight. The changed path called the scoped preparation;
the process regression test separately verifies that the real capability probe
and viewer launch add no export preflight.

| Path | Preparation time | Note reads | Folder enumerations | Config existence checks |
| --- | ---: | ---: | ---: | ---: |
| Baseline, first open | 829 ms | 3,000 | 3 | 919 |
| Scoped, first open | 1 ms | 0 | 0 | 3 |
| Baseline, repeat open | 432 ms | 2,000 | 2 | 613 |
| Scoped, repeat open | less than 1 ms | 0 | 0 | 3 |

These are single-run preparation measurements, not end-to-end Obsidian startup
times or a guarantee for another vault. Helper startup/indexing, asset loading,
schema loading and first-row display were excluded. The loading dialog has no
intentional delay; removing its text would not remove preparation work.

## Quiet viewer startup

The shared viewer's engine initialization no longer opens a modal progress
dialog. The ordinary viewer/grid remains visible while initialization finishes;
startup errors still appear in the status area. Progress dialogs for explicit
file indexing, saving and resetting are retained. No startup timer or artificial
minimum duration was added.

The source change was introduced in csvzall commit `a7d9664` and is included in
released csvzall 0.9.0. Packaged WASM assets record the released source revision,
with the unchanged source-refresh and digest checks. Desktop 0.9.0 prepares its
native production helpers from that same release through the normal verified
three-platform helper workflow; see [the release log](desktop-release-0.9.0.md).

For local Windows testing, `.test-build/quiet-startup-plugin-verified/` contains
a development plugin embedding the rebuilt native helper, produced and smoke
tested with `scripts/build-windows-sync-test.mjs`. The test vault's three plugin
artifact symlinks can target that directory while its `data.json`, helper cache
and journal remain vault-local. Rebuilding root `main.js` alone does not refresh
that separate development bundle; rerun the development packager into a new
directory and repoint the links when testing later native changes.

Regression tests in `tests/export-reflection.test.ts` assert zero note/folder
scans during normal viewer preparation, while checking reconstruction,
deletions, inherited/destination conflicts and a concurrently queued global
pass. `tests/markdown-service.test.ts` covers unchanged-note reuse, same-size
event invalidation, malformed edits and unsaved buffers. All existing Sync
regressions remain required.

The hybrid storage model and Sync prerequisites are unchanged; see
[Obsidian's Sync settings guidance](https://obsidian.md/help/sync/settings).
