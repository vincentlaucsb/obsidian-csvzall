# Export configuration reflection for Obsidian Sync

Status: implemented, tested, and prepared for release 0.8.0 on 2026-10-19.
See the [release log](obsidian-sync-release.md). The design
and acceptance criteria below remain the reference for the implementation.
The [direct-folder migration decision](direct-folder-export-plan.md) supersedes
ancestor lookup and inherited-scope storage in this original plan: each folder
now owns its direct CSVs and export notes, with automatic migration of old configs.
See [local testing and release status](obsidian-sync-testing.md) for the required
development helper selection and checks not yet performed with real Sync devices.

## Decisions and scope

csvzall remains a standalone CLI with its existing JSON format and chart
generation commands. obsidian-csvzall owns the Obsidian integration:

```text
local .csvzall/*.json <-> obsidian-csvzall <-> plugin data.json <-> Obsidian Sync
```

- Keep `.csvzall/charts.json` and `.csvzall/exports.json` usable by their existing
  consumers. Continue supporting the existing `tables.json` migration.
- Reflect definitions into `<active configuration folder>/plugins/csvzall/data.json`
  using the plugin data APIs. Do not invent a separate arbitrary JSON file under
  `.obsidian` and assume Sync will transport it.
- Preserve scoped IDs, relative paths, paused exports, unknown fields, and source
  and generated files. Restore missing local configs from reflected data.
- Resolve conflicts automatically: newest export definition wins. Do not introduce
  a conflict-resolution dialog. Preserve unrelated edits to different exports.
- Preserve automatic stale SQL table/value cleanup. Charts have no stale cleanup;
  missing chart output is not a reason to remove a chart definition.
- Suppress repetitive background notices throughout a plugin session and recover
  when missing configuration or source files become available.
- Add one explicit upstream integration, `csvzall view --obsidian`. The plugin
  supplies it; the CLI does not discover vaults or configuration profiles.
- Separate profiles are intentional and may have separate plugin data. Use the
  current Obsidian instance's configuration folder; do not search other profiles.
- Desktop export integration is in scope. Do not add chart/SQL generation or
  native services to csvzall Lite. Preserve mobile builds and checks.
- The existing README disclosure about the large desktop bundle remains as-is.
  Additional Sync Standard accommodation is outside this implementation.

## Verified behavior and current implementation

[Obsidian's Sync guidance](https://obsidian.md/help/sync/settings) excludes hidden
vault folders, with an exception for the active configuration folder. The
configuration-folder and ordinary file-type Sync controls are distinct. Plugin
configuration needs installed community plugin syncing; ordinary CSV/TSV files
need **Sync all other types**. These choices are configured per device.

[Configuration folders](https://obsidian.md/help/configuration-folder) can be
overridden. This plugin already has access to `app.vault.configDir` and its
plugin directory. It does not need filesystem-based profile detection.

The installed Obsidian 1.14.4 implementation was inspected during planning:
`data.json` is explicitly included in the standard plugin-file Sync allowlist,
under **Installed community plugins**, which includes plugin settings. This is
implementation evidence for that version, not a public Sync inspection API.

The [public plugin API](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts)
defines `loadData()`, `saveData()`, and `onExternalSettingsChange()`. Use the last
hook to react to incoming data without requiring a restart. The
[Sync conflict documentation](https://obsidian.md/help/sync/troubleshoot) describes
JSON settings merging; it does not guarantee the per-export newest-wins behavior
we need. Reconciliation must implement that policy itself.

Relevant existing code:

| Concern | Existing location and behavior |
| --- | --- |
| Chart discovery | `src/charts/chartConfigFiles.ts` checks root and nested hidden configs |
| Chart path resolution | `src/chartAutomation.ts` derives the scope from the config location |
| Chart mutation | `src/charts/ChartDefinitions.ts` stages, validates, and checks concurrent changes |
| SQL definitions | `src/markdown/ExportDefinitions.ts` preserves scoped definitions and legacy migration |
| SQL cleanup and notices | `src/markdown/MarkdownTableService.ts` indexes notes, polls, and prunes unused linked definitions |
| Chart cleanup | `src/settings/ExportSettingsService.ts` currently deletes definitions when chart outputs are deleted; remove this behavior |
| Plugin persistence | `src/main.ts` currently saves normalized settings wholesale; this must preserve reflected data |
| Background scheduling | `src/watchers/registerVaultWatchers.ts` polls hidden configs and schedules on CSV modifications |
| Process notices | `src/process/CsvzallProcessService.ts` reports each failed chart command |

Upstream, `src/pipeline/commands/view/server.cpp` regenerates run-on-save charts
inside the CSV save endpoint. The plugin also schedules charts from vault events,
so hosted saves currently have two possible automation owners. Native viewer
chart actions in `view/charts.cpp` read/write ordinary `.csvzall/charts.json`.

## Upstream Obsidian-mode contract

### Invocation and behavior

Add a boolean `--obsidian` option to the `view` command:

```text
csvzall view <csv-path> --edit --no-open --startup-json --obsidian
```

Its meaning is: the caller is the Obsidian plugin, which owns background export
automation and configuration reflection for this viewer session.

1. The CSV save endpoint still validates and writes the CSV normally. When
   `--obsidian` is set, it skips native automatic run-on-save chart generation.
   Return the existing successful save response with zero automatically generated
   charts and no automatic-chart error. A successful CSV save must not become a
   failure because an unrelated export cannot run.
2. Explicit Preview, Generate, and Save chart actions remain operational, including
   immediate generation requested by a user saving chart options. They continue
   reading/writing standard `.csvzall/charts.json`. The plugin observes those
   changes through its own mutation callbacks or polling.
3. Keep existing CSV editing, save acknowledgments, local-server token checks,
   dirty-state protection, theme handling, and browser-opening flags unchanged.
   The mode flag itself does not imply `--no-open`, `--edit`, or `--startup-json`.
4. With startup JSON requested, add an explicit acknowledgment:
   `"obsidianMode": {"version": 1, "chartAutomation": "host"}` alongside `url`.
   Without the flag, preserve the existing startup output. Normal text startup
   output remains the URL. The plugin validates acknowledgment before accepting
   the session as host-managed.
5. With no flag, preserve standalone run-on-save generation and existing CLI
   behavior. `charts run --config ...` and SQL commands need no Obsidian flag.

Pass the option through command parsing, `RunView`, and `ViewServerOptions` to the
save handler. Keep it a small, source-tested extension of the existing viewer
session contract. No additional viewer bridge or chart-save notification protocol
is needed for reflection in this release; bounded plugin polling covers native
viewer writes, including viewers opened in an external browser.

### Excluded responsibilities

The flag does not search for `.obsidian` or custom profiles, read or modify plugin
`data.json`, choose a Sync service, reflect definitions, change the JSON schema,
or redirect chart files. It does not pass the configuration-folder path to the
CLI. All of that integration stays in obsidian-csvzall.

The plugin reconciles local configs before starting the hosted viewer and before
background export commands. It passes `--obsidian` for its native viewer launches,
both embedded and external-browser launches. Independently launched CLI viewers
keep standalone automation; the plugin does not try to control those processes.

### Older custom executables

The bundled helper must implement the flag and acknowledgment. For custom helpers,
check advertised `view --help` support once per executable identity/version and
validate the actual startup acknowledgment. If unsupported, show one actionable
message to update the helper or use the bundled helper. Do not silently retry a
hosted viewer without the flag and reintroduce duplicate automation. Unrelated
CLI commands and existing source/generated files remain available.

## Reflection data model

### Logical identities and payloads

Identify an entity by normalized vault-relative configuration path, kind, and
existing ID. For example, root chart `sales` and
`Projects/Budget/.csvzall/charts.json` chart `sales` remain distinct. Kind separates
chart and SQL exports. Case-sensitive paths and existing scope lookup semantics
are preserved; reject paths escaping the vault rather than rebasing them.

Keep each raw definition as JSON, preserving unknown properties. Also represent
each config document's unknown top-level fields and entry order as a separate
document-metadata entity. Merge surviving IDs into the recorded order and append
new IDs deterministically. Deleting an entry must not erase file-level metadata.

Do not put reflection metadata into CLI JSON. The plugin envelope records:

- A schema version and entity identity.
- The raw definition or document-metadata payload, or a deletion marker.
- Modification time, deterministic tie-break information, and a content digest.
- Deletion reason: explicit deletion, observed entry removal, or stale SQL cleanup.

### Transport records and local journal

Use independently keyed immutable revision records at the top level of plugin
`data.json`, under reserved `csvzallExportRevision:<revision-digest>` keys, plus a
`csvzallExportSync` schema descriptor. Each record carries its own schema version.
The digest covers the complete canonical revision. Identical keys must therefore
have identical content. Do not store every export in a single replace-all array
or assume Obsidian performs a suitable deep merge of a nested map.

This layout lets ordinary JSON key merging preserve independently created
revisions. Both old and new revisions can arrive in either order; the plugin
reduces them to the newest record per entity. Actual Obsidian merging remains an
integration test requirement, not an assumption that replaces those tests.

Keep a durable device-local journal under the active plugin directory, outside
`data.json`, for pending revisions, last verified file digests/payloads, materialized
winners, migration receipts, a stable random origin ID, and observed note references. Use a dedicated
`export-sync-local/` subdirectory and exclude it from checked-in test-vault state.
It is not part of the supported standard plugin Sync file set. It must be safe
to rebuild the local baseline from reflected records; losing this journal must
never imply that all missing local files were deliberately deleted.

Persist a local pending revision before publishing it or replacing CLI files.
Retain immutable revisions and deletion records in the first release; do not
garbage-collect them using a time limit that could let an old device resurrect
exports. Future compaction requires a separately designed acknowledgment strategy.
Record counts and growth should be observable without recording every poll.

## Newest-wins ordering

For plugin-originated semantic edits, stamp the edit when it commits, not when it
is later reflected. For external CLI/manual JSON edits, compare validated content
with the local baseline and stamp only entries that actually changed. Use the
stable file modification time as the best available edit time for such entries.

Unmodified CLI JSON has no per-entry historical timestamps. Migration and offline
external edits therefore have file-level time precision; do not claim to recover
exact historical edit order from that format. Use one stable timestamp source
per import, retain it in the journal, and never replace it with the discovery
time on every startup.

Compare revisions by the tuple `(clockMs, counter, originId, revisionDigest)`.
For a new plugin edit, set `clockMs` to the greater of the wall time and the
greatest revision clock already observed. Increment the logical counter if that
millisecond is reused; otherwise start it at zero. This makes a causally later
plugin edit sort after an observed winner even if the local wall clock moved
backward. External file imports use their stable file time as `clockMs` with a
deterministic counter; observing/importing an old file must not inflate its clock.
Independent offline edits are ordered by their recorded times; incorrect device
clocks remain a limitation of newest-wins. No extra upstream timestamp fields
are required.

Reflection, file reconstruction, formatting changes, generation, log writes,
retries, and polling do not create semantic revisions or advance edit time.
Deletions participate in the same ordering as live definitions. Newer explicit
recreation can supersede a deletion; an unchanged stale copy cannot.

If a device with no baseline has local legacy definitions and received revisions,
an identical payload adopts the received record. A differing payload competes
using its stable legacy file time. Store its imported digest once. Never keep
republishing an unchanged losing legacy definition with a fresh timestamp.

## Persistence and reconciliation lifecycle

### One plugin data writer

Introduce a focused plugin-data coordinator. All settings, installer, event-log,
and reflection saves use it; none calls `saveData(this.settings)` independently.
Keep normalized settings as a view over the full data document. Preserve reserved
revision keys, unknown plugin-data fields, and remote changes on every save.

Serialize local operations, read the latest disk data before applying a patch,
union validated immutable revisions with the durable journal, reduce winners, and
verify persistence. React to `onExternalSettingsChange()` through the same queue.
Do not assume `saveData()` and Sync form a transaction: retain unacknowledged
local revisions and reconcile again after external changes or failed verification.
Do not overwrite malformed or newer unsupported data with normalized defaults.

### Startup

1. Load plugin data and the device-local journal without publishing an empty state.
2. Snapshot and validate existing CLI configs before applying incoming winners;
   this protects edits made while Obsidian was closed.
3. Import genuine local changes and reduce local plus reflected revisions.
4. Persist pending revisions, then publish and materialize verified winners.
5. Load chart/SQL services from the reconciled local files and enable scheduling.
6. Enable stale SQL assessment only after its reference checks are satisfied.

An empty or missing plugin data file is not an instruction to delete local
definitions. A missing local config is not an instruction to delete synced
definitions. If nothing is present, wait for future local or incoming changes;
do not repeatedly save an empty namespace.

### Ongoing changes

- Route plugin-created/edited/deleted definitions through the coordinator and
  schedule reflection immediately after a successful mutation.
- Poll known hidden configuration paths on the existing ten-second cadence and
  refresh before export commands. Discover root and nested scopes from indexed
  folders, incoming config identities, and previously tracked paths.
- Validate a stable file snapshot before importing an external write; debounce
  rapid changes and recheck size/time/content across reads. Invalid or partial
  JSON is retained for retry and cannot replace the last good revision.
- Incoming plugin data triggers reconciliation, local materialization, affected
  service reloads, and coalesced automatic runs only for applicable unpaused
  exports. A CSV save does not race ahead of queued config reconciliation.
- A semantic digest matching the last materialization is a no-op. Updating a
  local baseline after a verified write prevents reflection loops.
- Serialize plugin file writes and generation per affected scope. Before replacing
  a file, compare with the snapshot used to prepare it; re-read and reconcile if
  it changed. Reuse the existing staging and conditional-write patterns. External
  CLI writers do not share this lock, so keep the journal and verify after writes;
  do not promise cross-process atomic transactions.
- Preserve last-good state through parse errors and keep unrelated scopes usable.
  Stop timers/queued mutations on unload; journal pending work for the next load.

Directory/source/note renames must update scoped identities and relative paths
through existing workflows, publishing corresponding moves/deletions as one local
operation. Incoming rename halves can arrive separately; unresolved paths suspend
affected work rather than causing cleanup. Do not move or rename users' sources
or generated outputs merely to materialize a configuration.

## Migration and recovery

Migration is a first import into the reflection model, not a move away from the
CLI format:

1. Inventory root/nested `charts.json`, `exports.json`, and legacy `tables.json`.
   Exclude previews, staging files, backups, and local journal files.
2. Read original bytes and validate without mutation. Finish existing table/marker
   migrations through their established verified-write procedure; preserve their
   backups and legacy ID bindings. Do not independently import both a legacy
   table and its already migrated equivalent.
3. Save a local recovery snapshot and durable source digest. Preserve definitions
   not currently referenced by notes as part of import; cleanup is a separate step.
4. Generate deterministic import revisions preserving scope, IDs, raw fields,
   path meaning, and stable file timestamps. Deduplicate identical entries and
   use newest-wins for differing definitions already received from another device.
5. Publish revisions and verify they can be loaded and reduced to the intended
   definitions. Record completion only after the journal and data are durable.
6. Keep existing CLI configs in place. Rewrite only when applying a winning change
   or performing the established legacy migration. Do not touch note markers or
   generated content simply because reflection was enabled.

Interrupted import resumes from durable receipts and content digests. Read/write
failures leave originals and last-good state usable. Unsupported schemas remain
untouched and produce one actionable diagnostic. An older plugin must not be used
to edit reflected data without the new preservation logic; describe this in the
upgrade documentation and retain local snapshots for recovery.

Run first on a device containing the missing definitions. A laptop possessing
only short note markers cannot reconstruct the missing SQL queries from IDs.
After reflected data arrives there, materialize the proper root/nested configs
without requiring manual copying or creating unrelated source/output folders.
If a required scope directory has not arrived yet, retain the definition pending
and retry when the directory becomes available.

## Deletion and stale SQL cleanup

### Explicit deletion and external entry removal

An explicit Delete operation creates a newest-wins deletion record and performs
the existing local detachment behavior while preserving sources and generated
content. Keep the last live payload available in revision history for recovery.
Do not automatically reattach markers after an intentional deletion.

Removing an entry from a valid, stable CLI config with a known baseline is an
observed deletion. Whole-file disappearance or an unreadable/empty/partial file
is not sufficient evidence: defer and reconstruct as appropriate. Removing all
entries in a valid JSON array can express an intentional external bulk deletion.

On a stale device, payloads identical to the last known baseline do not create
new revisions merely because their winning record is now a deletion. On a device
without a baseline, stable import timestamps and retained tombstones decide the
winner rather than treating import time as a new edit.

### SQL tables and inline values

Keep the existing linked-export eligibility rules and scope-aware marker lookup;
do not prune unlinked/manual definitions simply because they have no note marker.
For eligible definitions, remove stale entries when no live reference remains,
using the following safeguards:

- Complete a successful reference scan, including unsaved open-note buffers.
  Respect pending writes, index revisions, renames, and cancellation guards.
- Track known reference paths locally and carry the original linked output hint.
  A missing/unreadable expected note, invalid marker structure, unresolved scope,
  or unapplied incoming revision makes the cleanup decision pending.
- Removing the final marker from an existing, readable note is positive evidence;
  disappearance of a note on a newly synced device is not. A fixed startup delay
  or two matching polls alone cannot prove Sync has finished.
- For deleted-note candidates, defer until a reliable Sync-idle indication plus
  a successful settled scan is available. Use a guarded adapter if available;
  when Sync state is unknown, keep ambiguous candidates pending rather than guess.
  Local confirmed plugin detachment/deletion actions need no remote idle signal.
- Publish automatic cleanup as a recoverable `stale-sql` deletion reason, separate
  from explicit deletion. If a valid late-arriving note references that definition,
  recover its last live payload and cancel the stale decision with a new revision,
  unless superseded by a newer explicit deletion or actual edit. This protects
  late note arrivals even after a device appeared settled.
- Recheck references immediately before mutation. Run cleanup only after
  reconciliation and never feed absence inferred from a failed index into Sync.

This preserves useful stale SQL removal while accepting that genuinely ambiguous
missing-note cases may take longer to clean up. Do not silently drop that safeguard
to reproduce the current eager startup pruning.

### Charts

Remove output-deletion pruning from `ExportSettingsService.register()` and its
`pruneDeletedCharts()` path. A deleted or not-yet-synced SVG does not make a chart
stale. Keep the definition available for future generation or explicit deletion.
Preserve paused charts. Reflect intentional config-entry deletion normally.

## Notices, logs, and recovery

Add a session-owned failure history shared by background export/config operations.
Fingerprint by operation, scoped export/note identity, and stable cause. Exclude
retry counters and transient timestamps, but retain distinctions between actual
different causes. Do not use only a last-error slot: alternating missing IDs
must not repeatedly notify. Successful runs and config reloads do not clear the
history. A plugin reload starts a new session.

- First failure is actionable and recorded once; batch simultaneous background
  failures into a concise summary where practical.
- Suppress duplicate notices, console errors, and persistent log writes. Keep
  repeat counts/last-seen state in memory so polling does not churn `data.json`.
- Manual retry still returns a visible result in its action/view. Do not hide
  errors from explicit operations merely because a background notice was shown.
- Keep existing generated content. Missing inputs/configs are pending work, not
  destructive resets. Invalid config retains the last-good state for diagnosis;
  suspend generation using that affected scope until a valid snapshot is available.
- Missing definitions/sources recover on relevant arrivals and bounded polling;
  failed external processes are not retried in an immediate tight loop.
- Cover chart load failures, chart process failures, SQL indexing/refresh errors,
  reflection failures, and cleanup errors. Keep successful background activity
  quiet; retain clear feedback for explicit generation commands.

## Settings diagnostics

Add an export Sync status near the existing export settings, evaluated during
render/check actions rather than expensive settings-definition indexing:

| Check | Meaning |
| --- | --- |
| Installed community plugins/configuration syncing | Required to transport this plugin's `data.json` |
| Sync all other types | Required for ordinary CSV/TSV sources, not standard plugin data |
| Excluded source/output folders | Relevant files may be unavailable even with type syncing enabled |
| Pending reflection or missing dependencies | Show a concise actionable status and allow recheck |

Obsidian has no public Sync inspection API in the installed type declarations.
Keep any private inspection in a small read-only `src/obsidian/` adapter that checks
every member and tolerates exceptions or changed shapes. Current implementation
evidence points to Sync's `filter.allowSpecialFiles` and `filter.allowTypes` sets;
validate exact keys/behavior during implementation and test them through fixtures.
Return enabled, disabled, inactive, or unknown separately. Do not inspect Sync
credentials, infer disabled from unavailable internals, or modify user settings.

If Sync is disabled or another service is used, reflection still works locally;
show relevant guidance without asserting that all users need Obsidian Sync.
Do not claim end-to-end synchronization merely because local switches are enabled.
Do not add profile discovery or attempt to merge intentionally different profiles.

## Code organization and implementation sequence

Proposed modules are responsibilities, not mandatory filenames:

| Area | Work |
| --- | --- |
| `src/exports/` | Pure identities/revision ordering, reflection schema, import/reconciliation, local materialization and lifecycle service |
| `src/settings/` | Full-document plugin-data coordinator and settings diagnostics UI |
| `src/obsidian/` | Guarded Sync status inspection, active plugin paths and local journal adapter |
| `src/charts/` | Wire successful mutations and pending scopes into reflection; preserve CLI config format |
| `src/markdown/` | SQL definition reflection, reference evidence and recoverable stale cleanup |
| `src/logging/` | Session failure history and bounded reporting |
| `src/process/` | Pass/validate the viewer mode contract and custom-helper support |
| `src/main.ts` | Compose services and forward external-data changes only |
| Upstream csvzall | Add the flag, startup acknowledgment, and hosted automatic-generation ownership switch |

Implementation order:

1. Add pure revision/schema/reconciliation logic and behavior tests, including
   unknown-field retention and per-export newest-wins deletion handling.
2. Introduce the full-document persistence coordinator and durable local journal.
   Route all existing saves through it before storing reflected records.
3. Add verified migration, local observation/materialization, startup gating,
   incoming-settings handling, and mutation callbacks. Retain CLI formats.
4. Apply chart deletion policy and SQL cleanup safeguards; verify late-note recovery.
5. Add session failure reporting and render-time Sync diagnostics.
6. Implement/test the scoped upstream `--obsidian` contract, then wire plugin
   launches and capability handling. Keep automatic chart ownership consistent
   throughout integration; do not ship an intermediate duplicate-owner state.
7. Update relevant docs, fixtures, and README behavior statements. In particular,
   narrow the existing automatic export-cleanup bullet to stale SQL exports.
8. Prepare the new pinned native helper snapshot using the existing provenance
   workflow, then complete desktop/mobile and source-archive validation.

The schemas and startup acknowledgment are listed in AGENTS.md's Version
Locations. The local implementation does not update published native helper pins;
new bundled archives must go through release preparation before distribution.

## Verification and acceptance criteria

Use injected clocks, file adapters, queues, and two-device data snapshots for
deterministic behavior tests. Add real Sync checks for assumptions that simulations
cannot verify. Keep the existing type-safety and packaging gates intact.

| Scenario | Required result |
| --- | --- |
| Existing root/nested chart, SQL table, value, and legacy table configs | Imports preserve IDs, scope, unknown fields, pause state and bindings |
| Unchanged import repeated or interrupted after any durable step | No duplicate revisions, timestamp inflation, lost config, or marker changes |
| Missing local configs on another device | Reflected data reconstructs files and exports recover |
| Local config edits while plugin is disabled | Next startup imports them before materialization can overwrite them |
| Two devices edit different exports offline | Both edits survive, independent of JSON arrival order |
| Two devices edit the same export offline | Newest wins identically; deterministic ties; no resolution dialog |
| Reflection or logging touches a file | Semantic edit timestamps and revision count stay unchanged |
| Explicit delete reaches a stale/new device | Older definitions stay deleted; newer explicit recreation works |
| Config file missing/partial/invalid | No false deletion or publication; originals and last-good state retained |
| Source/note/folder renamed with events arriving in stages | Scope and paths remain correct; pending states do not trigger deletion |
| Final live SQL marker removed | Eligible stale definition is removed and deletion is reflected |
| Another note still references the SQL export | Definition remains live |
| Config arrives before its note; note arrives after stale cleanup | No permanent loss; valid reference recovers automatic cleanup, not explicit deletion |
| Generated chart deleted or not downloaded yet | Chart definition remains available |
| Alternating failures, retries, successes and later recurrence | No repeat background notice/log for the same session fingerprint |
| Settings/log/installer save races incoming export data | Neither unrelated settings nor export revisions disappear |
| Plugin unload during pending writes or viewer startup | No late mutation; pending durable work resumes safely |
| Custom executable lacks flag or acknowledgment | One actionable error; no silent unflagged hosted launch |
| Native CSV save without `--obsidian` | Existing standalone automatic chart generation still runs |
| Native CSV save with `--obsidian` | CSV saves successfully; native automatic generation is skipped; plugin schedules once |
| Manual chart actions with `--obsidian` | Preview, save and generation still work and config edits are reflected |
| Private Sync members missing/changed/throwing | Unknown status; plugin continues functioning |
| Two devices using the same active config profile | Actual plugin data carries the revisions and local configs converge |
| Intentionally separate config profiles | No cross-profile discovery or merge |
| Plugin/config syncing disabled vs ordinary file syncing disabled | Correct distinct guidance without changing user settings |

Run the applicable upstream viewer/CLI tests; `npm run lint`; `npm test` (including
desktop and mobile builds); and `npm run check:source-archive` before release.
Run the existing helper preparation/verification checks when native pins change.
Use `demo-vault/` for reproducible local fixtures and two disposable real Sync
vault instances for end-to-end acceptance. Keep local journals, credentials,
plugin installations, and build outputs untracked. Record unavailable real-device
checks explicitly rather than treating mocked success as a completed Sync test.

The feature is complete when normal CLI JSON remains usable, the plugin reflects
and restores definitions through standard plugin data, newest-wins decisions
converge, stale SQL cleanup remains useful without deleting charts, and missing
files no longer cause repetitive background errors.
