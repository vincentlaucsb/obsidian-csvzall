# CSV viewer startup preparation

Opening a native viewer prepares its chart configuration separately from global
export reconciliation. The scoped pass reads chart configurations along the
CSV's ancestor chain and follows their destination/relocation dependencies. It
does not enumerate vault folders or discover SQL references in Markdown notes.
This retains automatic localization of inherited charts, destination collision
checks, verified writes, incoming revisions and deletion ordering. Pending
renames and an already-running reconciliation are still awaited.

`CsvService` runs chart preparation alongside native helper startup. The helper
indexes the CSV and starts listening while preparation runs. The plugin exposes
the URL after both finish, before the viewer can request chart definitions.
The process service does not repeat global reconciliation on launch or for `view --help`. Export
commands retain their preflight reconciliation and post-preflight scope guards.

When the scoped configuration is already durable, one fresh read verifies
the requested plugin data and the retained revision keys. Missing revisions
and changed definitions still go through the merge and write verification.
The bundled helper launches directly and acknowledges host-owned chart
automation. Custom helpers also run the capability probe on first use. In
Lite, the vault read overlaps iframe startup.

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

## First rows on open, November 24, 2026

The shared viewer requests the first page as soon as the grid asks for it.
Subsequent page requests wait for 40 ms of quiet after vertical scrolling.
In a browser test with the rebuilt Windows helper and 100,000 rows, the grid
requested the first page once. The first scroll fetch started 42 ms after the
last scroll event, and the requested rows appeared.

The Windows benchmark opened `demo-vault/Productivity Tracker.csv` 16 times
per version in headless Chromium. Both versions used the same plugin code,
native helper and CSV. Only the viewer's row scheduling differed. First rows
were timed at the first animation frame after a data cell contained text.

| Median elapsed time | Previous viewer | Immediate first page |
| --- | ---: | ---: |
| File-open hook to first populated cells | 271 ms | 257.5 ms |
| Iframe navigation to first populated cells | 207.5 ms | 183.5 ms |

The file-open measurement includes chart preparation on disk, native helper
startup and viewer rendering. The harness supplied Obsidian's view and vault
interfaces. Timing starts after the app has dispatched the open to the plugin.

## Native viewer bundle and parallel chart preparation

A second Windows comparison used the existing immediate-first-page helper as
the baseline. It opened the same CSV 16 times per build using embedded assets,
real chart preparation on disk and the plugin's native file-open path in a
Chromium harness. Both builds used bundled-helper launch settings. Custom
helpers also have a one-time capability check.

| Median elapsed time | Previous build | Bundled scripts and parallel preparation |
| --- | ---: | ---: |
| File-open hook to first populated cells | 260 ms | 202 ms |
| Iframe navigation to first populated cells | 185 ms | 155.5 ms |

The native production viewer loads its first-party scripts and menu library in
one JavaScript bundle. Developer asset mode still serves source modules.

The next Windows comparison used AG Grid 32.3.9's `noStyle` distribution with
the same separately loaded grid and Alpine stylesheets. This removed 521,852
bytes of JavaScript. Across 24 opens per packaged helper in the same harness,
median file-open time to first populated cells fell from 239.5 to 214.5 ms.
Measured from iframe navigation, the median fell from 177.5 to 158 ms.
The light and dark grid screenshots matched their respective baselines.

## Native first-page prefetch

The native viewer starts an authenticated request for the first 500 rows before
it builds the grid. The initial unsorted page consumes that response once. A
different range, a sort, or a write discards it. A failed prefetch retries when
the grid requests the page.

Two Windows Release helpers with embedded assets opened each CSV in a fresh
Chromium iframe. Each pair alternated which helper ran first. Two sessions
contributed 24 measured pairs each per file, after warmups. Timing started at
iframe navigation and ended on the first animation frame after the first cell
contained its expected value.

| CSV | Median paired head start for row request | Median paired improvement for first populated frame | Opens with earlier first frame |
| --- | ---: | ---: | ---: |
| Productivity Tracker (56 rows) | 97.3 ms | 5.7 ms | 29 of 48 |
| Synthetic (100,000 rows) | 95.1 ms | 3.5 ms | 26 of 48 |

All 192 measured opens issued one first-page request. The request started
earlier in every pair, but first-frame times varied. On the larger file the
prefetch build's median first frame was 1.4 ms later in one session and 8.7 ms
earlier in the other. A separate scroll test on that file fetched new rows
43 ms after the final scroll event.

## First-frame profile of the packaged Windows helper

The prefetch helper opened each CSV in a fresh Chromium iframe with its
embedded scripts and styles. For each file, 16 opens timed grid API calls and
16 control opens observed only the first populated cell and its next animation
frame. The runs alternated order. Two additional renderer CPU traces captured
one open per file. These timings exclude Obsidian's file-open handler.

| Median elapsed time | Productivity Tracker (56 rows) | Synthetic (100,000 rows) |
| --- | ---: | ---: |
| Helper spawn to ready URL, before iframe navigation | 36.6 ms | 189.6 ms |
| Iframe navigation to start of grid construction | 54.5 ms | 54.7 ms |
| Construct grid with empty column definitions | 29.0 ms | 29.7 ms |
| Install CSV column definitions | 18.6 ms | 18.7 ms |
| Install datasource | 4.7 ms | 5.0 ms |
| Datasource installed to grid requesting rows | 9.4 ms | 9.8 ms |
| Grid requesting rows to delivery callback starting | 0.4 ms | 0.8 ms |
| Execute grid's row-delivery callback | 7.6 ms | 8.5 ms |
| Iframe navigation to first populated frame, control | 142.4 ms | 144.8 ms |

The prefetched row bodies were available to JavaScript 42–43 ms before the
grid requested them. While applying the CSV columns, both traces showed AG
Grid checking horizontal scrollbar visibility in response to displayed-column
changes and Chromium recalculating layout. One experiment is to supply the
real column definitions at grid construction and compare first frames.
The grid still needs to lay out the initial columns. A paired benchmark can
show how much repeated layout this avoids.

A separate eight instrumented opens per CSV isolated the first
`Number.prototype.toLocaleString()` call for the toolbar's row count.
It took a median 7.9 ms on the demo and 8.4 ms on the larger file, before the
viewer supplied columns to the grid. Deferring that formatting until after the
first populated frame is a smaller experiment that preserves localized counts.

## Deferred initial row count

The native viewer gives the first delivered rows a frame to paint before
formatting the toolbar count. The same guard covers the SQL toolbar restoring
the CSV view during startup. A header-only CSV shows its count immediately.

Two benchmark sessions compared packaged Windows Release helpers with the same
first-page prefetch. Each file had 48 measured pairs in alternating order after
warmups, with a fresh Chromium iframe and helper process for every open.

| CSV | Median first populated frame before | Median first populated frame after | Median saving within pairs | Faster pairs |
| --- | ---: | ---: | ---: | ---: |
| Productivity Tracker (56 rows) | 139.8 ms | 128.6 ms | 9.0 ms | 41 of 48 |
| Synthetic (100,000 rows) | 138.1 ms | 130.1 ms | 10.0 ms | 34 of 48 |

Frame timing started at iframe navigation. Across all 96 opens of the changed
helper, the correct localized count appeared after the first populated frame,
with median delays of 13.6 ms and 13.0 ms respectively. Every open issued
one first-page request. A separate packaged check verified the count on a
header-only CSV, after inserting a row, in SQL results, and after exiting SQL.

## Passing CSV columns to the grid constructor

This experiment compared the deferred-count helper with one that fetches the
schema and first page concurrently, then passes the CSV columns to
`createGrid()`. Both packaged Windows helpers requested one schema and one
first page per open. The experiment installed one datasource and issued no
follow-up column-definition update or sort reset during startup.

| CSV | Pairs | Median first populated frame before | Median with initial columns | Median change within pairs |
| --- | ---: | ---: | ---: | ---: |
| Productivity Tracker, 56 rows × 3 columns | 48 | 129.3 ms | 131.0 ms | 0.8 ms later |
| Synthetic, 100,000 rows × 4 columns | 48 | 124.9 ms | 128.8 ms | 4.7 ms later |
| Synthetic, 1,000 rows × 60 columns | 24 | 146.6 ms | 148.3 ms | 5.6 ms later |

Each pair alternated the order of the two builds. Timing ran from iframe
navigation to the first animation frame with the expected first cell. Separate
instrumented runs on the two narrow files measured 27–28 ms to construct the
empty grid and 17–18 ms to install the columns. Creating the grid with the
columns already supplied took 44–45 ms. The change eliminated a grid API
call but produced no first-frame speedup on these fixtures. The native viewer
returned to installing the columns after grid creation and retains the deferred
row count.

## Native helper startup before the URL

The Windows deferred-count helper linked in Vince's Notebook took a median
190.4 ms from process launch to receipt of the startup JSON for the 100,000-row,
four-column fixture (2,678,913 bytes). A 56-row prefix with the same headers
took 36.8 ms. Each measurement used a fresh process, the plugin's editable
Obsidian arguments, two warmups and 24 measured opens with warm filesystem
caches. The harness stopped timing before making any HTTP request.

An instrumented Release build took 194.5 ms on the large file. Its timestamps
were collected in memory and written after the URL. Median wall times by stage
are rounded independently.

| Stage on 100,000 rows | Median |
| --- | ---: |
| Parent launches process to entry into `main` | 29.4 ms |
| CLI dispatch and initial file checks | 0.2 ms |
| Detect delimiter and quote | 21.1 ms |
| Start the CSV reader and read header metadata | 15.6 ms |
| Scan records, store byte offsets and construct logical editing rows | 104.8 ms |
| Finish opening the indexed data | 2.5 ms |
| Construct the server, including its copy of the indexed data | 15.4 ms |
| Configure routes, bind, wait for the listener and flush the URL | 4.1 ms |

A diagnostic split the 104.8 ms loop into two passes. Scanning and recording
offsets took 21.3 ms, while building the editable row vector took 86.8 ms.
In a second interleaved comparison, both builds used the split loop. Reserving
the exact capacity once the offset count was known brought editing-row
construction from 75.0 ms to 19.3 ms. Both builds returned the expected row
count and first row. These diagnostics used the regular Windows Release
compiler settings and separate executables. A final 24 interleaved opens per
build measured 172.7 ms for the linked helper, 172.5 ms for the instrumented
original algorithm, and 118.0 ms for the split-and-reserve diagnostic.

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
