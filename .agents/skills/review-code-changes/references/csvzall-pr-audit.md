# What the csvzall PR history teaches about code review

Snapshot taken November 24, 2026 (Arizona). The inventory covers all GitHub PRs in the three repositories at that point.

| Repository | Merged | Closed without merge | Open |
| --- | ---: | ---: | ---: |
| csvzall | 20 | 0 | 1 |
| obsidian-csvzall | 17 | 5 | 1 |
| obsidian-csvzall-mobile | 12 | 0 | 0 |

The audit used PR descriptions, commit messages, changed-file inventories and PR conversations, with selected implementation and test diffs checked for the failure cases below. GitHub returned no submitted reviews or inline review comments. Some authors recorded review outcomes and test runs in PR descriptions and commits. Treat those as historical reports. Preparation PRs and generated syncs can carry a fix across repositories, so their count is a poor estimate of defect frequency.

## Examples to use in reviews

| Failure | Discriminating check |
| --- | --- |
| A viewer declares a save complete while the vault write can still fail. A late completion for file A can clear a newer edit or replace file B. | Hold the write pending, edit again or switch files, then reject or resolve it. Inspect the dirty buffer, active view and persisted bytes. [Desktop #6](https://github.com/vincentlaucsb/obsidian-csvzall/pull/6) · [Lite #6](https://github.com/vincentlaucsb/obsidian-csvzall-mobile/pull/6) |
| An existence check finds an empty destination, then another process creates it before the first writer publishes. A normal replace can erase the winner. | Put the competing create between the check and publication. Inspect the winning file and the losing command’s result. The fix uses no-replace publication. [Native #30](https://github.com/vincentlaucsb/csvzall/pull/30) |
| A receiving device sees a note or destination late. Cleanup can convert incomplete information into a durable deletion that propagates to other devices. | Deny a destination read separately from reporting absence. Deliver source, destination and newer edits in different orders. Inspect contents, unknown fields, revision and retry behavior after reopen. [Desktop #19](https://github.com/vincentlaucsb/obsidian-csvzall/pull/19) · [Desktop #35](https://github.com/vincentlaucsb/obsidian-csvzall/pull/35) |
| A valid chart fails because a different configuration is invalid. A missing source can also block independent exports in the same note. | Put a good item and a bad item in the same batch and request the good one directly. Inspect both outputs and the aggregate error when running the full batch. [Native #26](https://github.com/vincentlaucsb/csvzall/pull/26) · [Desktop #34](https://github.com/vincentlaucsb/obsidian-csvzall/pull/34) |
| A path works on ordinary inputs but silently changes someone’s data on save. Examples include an uneven TSV row, an identifier larger than JavaScript’s exact integer range, or chart SQL omitted by an older form. | Round-trip a discriminating fixture through the actual consumer. Compare untouched fields, row order, delimiter and identifier text. Distinguish an absent form field from an explicitly cleared one. [Desktop #18](https://github.com/vincentlaucsb/obsidian-csvzall/pull/18) · [Native #39](https://github.com/vincentlaucsb/csvzall/pull/39) · [Native #40](https://github.com/vincentlaucsb/csvzall/pull/40) |
| A debounce that protects incomplete SQL also delays explicit work if it is applied at the wrong entry point. An autosave of generated output can start the same query again. | Use a controlled clock. Type, autosave, explicitly refresh, and edit an unrelated note. Count queries and assert the final output. For a grid, observe the first request immediately and coalescing during subsequent scrolls. [Desktop #26](https://github.com/vincentlaucsb/obsidian-csvzall/pull/26) · [Native #40](https://github.com/vincentlaucsb/csvzall/pull/40) |
| The ordinary CLI passes CI while a slim helper omits the named-table loader. A source change can also miss the shipped viewer if a recipe reuses stale outputs. | Run a named-table query on the built slim helper. Inspect the shipped source and toolchain pins, then smoke-test one affected capability in each changed distribution. [Native #39](https://github.com/vincentlaucsb/csvzall/pull/39) · [Desktop #35](https://github.com/vincentlaucsb/obsidian-csvzall/pull/35) |

## The work in progress

**Native viewer.** At `b69e671`, pages carry source row IDs. A reviewer can sort, edit a key so its row moves, Tab into the next editor, save, and reopen in source order. Inspect every entry point for positional row moves while sorted. The first page is requested immediately, subsequent scrolling retains a 40 ms delay, and the native adapter tests cover duplicate consumption, changed requests and failed prefetch. Those existing guards matter when re-reviewing. [PR #40](https://github.com/vincentlaucsb/csvzall/pull/40) · [Paging regression](https://github.com/vincentlaucsb/csvzall/blob/b69e6718549b24a1199684a0bbaedd7a93931b3b/src/viewer_wasm/web/test/paged-datasource.test.mjs) · [Adapter regressions](https://github.com/vincentlaucsb/csvzall/blob/b69e6718549b24a1199684a0bbaedd7a93931b3b/tests/viewer_adapters.test.mjs)

**Desktop and Lite integration.** At `962eedc`, both the desktop native recipe and the imported WASM asset record the audited native head. Later commits cover pending renames after a live-note read fails, a new JSON file staying editable while the previous file recovers, preservation of chart SQL, and invalidation of helper reuse when a target’s locked bundler changes. Review can follow a single revision across owner, packaging and consumer, then exercise the relevant behavior. The earlier preparation PR #36 names an older helper revision. [PR #35](https://github.com/vincentlaucsb/obsidian-csvzall/pull/35) · [Native build pin](https://github.com/vincentlaucsb/obsidian-csvzall/blob/962eedc9a085d15c82705c8942149ab952ef4ab2/native-binaries/build.json) · [WASM provenance](https://github.com/vincentlaucsb/obsidian-csvzall/blob/962eedc9a085d15c82705c8942149ab952ef4ab2/wasm-viewer/csvzall-wasm-viewer.json)

**Measured counterexample.** In the packaged Windows helper benchmark, deferring localized row-count formatting saved a median **10.0 ms within pairs** from iframe navigation to the first populated frame on the 100,000-row CSV. Passing columns to the grid constructor removed an API call but made the same endpoint **4.7 ms later within pairs** in a separate experiment. The latter change was reverted. Each comparison used 48 alternating pairs on that file. Calls, populated frames, and time from process launch to URL readiness answer different questions. These figures come from the PR’s benchmark record. [Benchmark method and results](https://github.com/vincentlaucsb/obsidian-csvzall/blob/962eedc9a085d15c82705c8942149ab952ef4ab2/docs/startup-performance.md)

## Complete PR inventory

### Native csvzall

| PR | Outcome | What changed or what failed |
| --- | --- | --- |
| [#7](https://github.com/vincentlaucsb/csvzall/pull/7) | Merged | Added host integration and editing. Follow-up fixes included path handling, SQLite type inference and JSON serialization. |
| [#10](https://github.com/vincentlaucsb/csvzall/pull/10) | Merged | Column ordering and renaming reached persistent edits. A follow-up fixed the editor’s handling of renamed columns. |
| [#11](https://github.com/vincentlaucsb/csvzall/pull/11) | Merged | Updated chart options for the current columns and strengthened the cache key. |
| [#12](https://github.com/vincentlaucsb/csvzall/pull/12) | Merged | Indexed paging and an edit overlay replaced size-based editing limits. The old mode spelling remained accepted. |
| [#13](https://github.com/vincentlaucsb/csvzall/pull/13) | Merged | Added a slim Obsidian build and enforced absence of external DLL dependencies. |
| [#14](https://github.com/vincentlaucsb/csvzall/pull/14) | Merged | Extended the specialized build to macOS and Linux. |
| [#15](https://github.com/vincentlaucsb/csvzall/pull/15) | Merged | Live host theme changes preserve the active grid. Keyboard settling, dropdown toggling and incremental asset detection received fixes. |
| [#16](https://github.com/vincentlaucsb/csvzall/pull/16) | Merged | Windows fixture placement caused unnecessary relinks and Make timestamp precision hid content edits. Tests cover real edits and no-op rebuilds. |
| [#17](https://github.com/vincentlaucsb/csvzall/pull/17) | Merged | Restored SQLite viewer workflows, preserved unsaved edits during host saves and unified Markdown cell escaping. |
| [#25](https://github.com/vincentlaucsb/csvzall/pull/25) | Merged | Documented how to carry controlled dependency fixes through version pins, fallback builds and downstream releases. |
| [#26](https://github.com/vincentlaucsb/csvzall/pull/26) | Merged | Isolated invalid chart definitions, corrected bar colors and label/axis layout, and carried chart SQL through the viewer. |
| [#27](https://github.com/vincentlaucsb/csvzall/pull/27) | Merged | Tests exposed bad quoting in export counts, Windows cleanup with a database still open, and missed output write/flush errors. |
| [#28](https://github.com/vincentlaucsb/csvzall/pull/28) | Merged | Shortened coverage builds by selecting tested targets while retaining test coverage. |
| [#29](https://github.com/vincentlaucsb/csvzall/pull/29) | Merged | Bounded build concurrency and cached compiler results while retaining MSVC Release debug-information defaults. |
| [#30](https://github.com/vincentlaucsb/csvzall/pull/30) | Merged | Added opt-in creation of a missing store. The follow-up closed the concurrent-create overwrite race and distinguished missing parents. |
| [#31](https://github.com/vincentlaucsb/csvzall/pull/31) | Merged | Prepared 0.7.0 with prior chart and merge fixes. |
| [#36](https://github.com/vincentlaucsb/csvzall/pull/36) | Merged | Added multi-table SQL and date/JSON functions. Transactional staging preserved existing tables and dependent views on failed replacement. |
| [#37](https://github.com/vincentlaucsb/csvzall/pull/37) | Merged | Preserved dialect, BOM and uneven rows on save. Isolated chart previews and made ownership of hosted chart regeneration explicit. |
| [#38](https://github.com/vincentlaucsb/csvzall/pull/38) | Merged | Added host-advertised note insertion and removed the engine startup modal. Explicit operations retained progress feedback. |
| [#39](https://github.com/vincentlaucsb/csvzall/pull/39) | Merged | Restored the shared SQL loader in the reduced helper and exercised Unicode, multiline text and large identifiers through SQL loading. |
| [#40](https://github.com/vincentlaucsb/csvzall/pull/40) | Open | View-only sorting, editor continuity, viewport scheduling and JSON/chart preservation. See the pinned review examples above. |

### Obsidian desktop and authored Lite source

| PR | Outcome | What changed or what failed |
| --- | --- | --- |
| [#1](https://github.com/vincentlaucsb/obsidian-csvzall/pull/1) | Closed unmerged | Proposed rename/reload and unsaved-change handling. The closing comment marked it stale/overlapping. |
| [#2](https://github.com/vincentlaucsb/obsidian-csvzall/pull/2) | Merged | Fixed Obsidian validation checks across authored modules and added viewer-helper test coverage. |
| [#3](https://github.com/vincentlaucsb/obsidian-csvzall/pull/3) | Merged | Added the mobile WASM host and iframe save/dirty bridge while retaining desktop-specific capabilities. |
| [#5](https://github.com/vincentlaucsb/obsidian-csvzall/pull/5) | Merged | Selected platform-specific slim helper assets and strengthened checks for the currently installed asset. |
| [#6](https://github.com/vincentlaucsb/obsidian-csvzall/pull/6) | Merged | Fixed lost edits on failed saves, obsolete viewer callbacks, rename handling, download failures and missing executables. |
| [#7](https://github.com/vincentlaucsb/obsidian-csvzall/pull/7) | Merged | Packaged host theme and interaction fixes, with source-owned behavior and checks on imported asset bytes. |
| [#9](https://github.com/vincentlaucsb/obsidian-csvzall/pull/9) | Merged | Added live Markdown exports. Verified migration writes, preserved prose and old output on failure, and waited for saves before navigation. |
| [#10](https://github.com/vincentlaucsb/obsidian-csvzall/pull/10) | Merged | Prepared 0.5.0 with checksum-pinned native helpers and clean-archive verification. |
| [#12](https://github.com/vincentlaucsb/obsidian-csvzall/pull/12) | Merged | Export management links to the owning note. Hidden configuration edits needed explicit refresh paths. |
| [#13](https://github.com/vincentlaucsb/obsidian-csvzall/pull/13) | Merged | Prepared 0.6.0 with the verified native 0.7.0 helper set. |
| [#16](https://github.com/vincentlaucsb/obsidian-csvzall/pull/16) | Merged | Fixed previews, stale SQL exports and literal scalar rendering. Carried variable-width and delimiter safeguards through to the package. |
| [#17](https://github.com/vincentlaucsb/obsidian-csvzall/pull/17) | Closed unmerged | Preparation snapshot incorporated into #16. No independent release or second fix. |
| [#18](https://github.com/vincentlaucsb/obsidian-csvzall/pull/18) | Merged | Fixed Lite saves that changed delimiters or lost fields in wider records. Tested hidden mobile Options and the host policy. |
| [#19](https://github.com/vincentlaucsb/obsidian-csvzall/pull/19) | Merged | Recovered configurations across Sync and folder migration. Verified destinations before retirement and retained deletion and relocation history. |
| [#22](https://github.com/vincentlaucsb/obsidian-csvzall/pull/22) | Merged | Prepared 0.9.0 with verified native 0.9.0 helpers. |
| [#23](https://github.com/vincentlaucsb/obsidian-csvzall/pull/23) | Closed unmerged | Proposed Brotli compression of the pinned executables. The merged packaging work appears in #24. |
| [#24](https://github.com/vincentlaucsb/obsidian-csvzall/pull/24) | Merged | Reduced the bundle by sharing and compressing helper content. Reconstructed executables retain the pinned checksums. |
| [#25](https://github.com/vincentlaucsb/obsidian-csvzall/pull/25) | Closed unmerged | Preparation snapshot for 0.10.0. The merged 0.10.1 packaging work is in #24. |
| [#26](https://github.com/vincentlaucsb/obsidian-csvzall/pull/26) | Merged | Debounced incomplete SQL per note while preserving explicit refresh, newer edits, and independence from unchanged autosaves. |
| [#27](https://github.com/vincentlaucsb/obsidian-csvzall/pull/27) | Merged | Prepared 0.10.2 with #26 and reused the existing helper snapshot. |
| [#34](https://github.com/vincentlaucsb/obsidian-csvzall/pull/34) | Merged | Fixed missing plugin data on fresh install and bounded export discovery. One unavailable CSV could previously block healthy exports. |
| [#35](https://github.com/vincentlaucsb/obsidian-csvzall/pull/35) | Open | Integrated agent skills and sorted editing, recovered from missing paths and pending renames, refreshed native/WASM assets and recorded startup experiments. |
| [#36](https://github.com/vincentlaucsb/obsidian-csvzall/pull/36) | Closed unmerged | Early sorting helper preparation from the first part of #35. Check the current integration head for the final pins under review. |

### Generated Obsidian Lite distribution

All twelve PRs came from the desktop repository’s sync workflow. The descriptions are nearly identical. The entries below use changed paths and merged diffs to distinguish shipped behavior from source-only and workflow changes.

| PR | Outcome | What changed or what failed |
| --- | --- | --- |
| [#1](https://github.com/vincentlaucsb/obsidian-csvzall-mobile/pull/1) | Merged | Synchronized the bundle and 0.1.1 compatibility metadata. |
| [#2](https://github.com/vincentlaucsb/obsidian-csvzall-mobile/pull/2) | Merged | Added mobile CSV creation via the command palette, ribbon and folder menu. Updated to 0.1.2. |
| [#3](https://github.com/vincentlaucsb/obsidian-csvzall-mobile/pull/3) | Merged | Brought in request-aware saves, rename handling and view-generation guards. |
| [#4](https://github.com/vincentlaucsb/obsidian-csvzall-mobile/pull/4) | Merged | Expanded release and validation scans for desktop-only runtime imports. |
| [#5](https://github.com/vincentlaucsb/obsidian-csvzall-mobile/pull/5) | Merged | Synchronized host theme subscription and its cleanup when a view is disposed. |
| [#6](https://github.com/vincentlaucsb/obsidian-csvzall-mobile/pull/6) | Merged | Added save-before-leaving acknowledgement and recovery when the viewer fails to confirm. |
| [#7](https://github.com/vincentlaucsb/obsidian-csvzall-mobile/pull/7) | Merged | Synchronized a shared view-type constant. Only the source file changed. |
| [#8](https://github.com/vincentlaucsb/obsidian-csvzall-mobile/pull/8) | Merged | Registered TSV alongside CSV and updated shared view code, styles and the bundle. |
| [#9](https://github.com/vincentlaucsb/obsidian-csvzall-mobile/pull/9) | Merged | Updated a lint directive explanation in shared source. No bundle change. |
| [#10](https://github.com/vincentlaucsb/obsidian-csvzall-mobile/pull/10) | Merged | Shipped 0.2.1 with the host UI policy, variable-width TSV fixture, updated packaging and bundle. |
| [#11](https://github.com/vincentlaucsb/obsidian-csvzall-mobile/pull/11) | Merged | Consolidated vault path handling for generated assets and new CSV files. |
| [#12](https://github.com/vincentlaucsb/obsidian-csvzall-mobile/pull/12) | Merged | Updated only the generated bundle. The PR record gives no separate bug diagnosis. |
