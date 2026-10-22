# Markdown export integration

`src/markdown/MarkdownTableService.ts` is the public facade and Obsidian event
router. Its constructor wires the following collaborators; `src/main.ts` keeps
using the same facade and command APIs. Mobile does not import these desktop
services.

| Component | Responsibility and owned state |
| --- | --- |
| `MarkdownNoteStore` | Authoritative editor/disk reads, parse cache, note revisions, guarded replacements and appends |
| `ExportRenderer` | Stateless SQL execution, previews, column discovery and Markdown/value conversion |
| `ExportRefreshService` | Source bindings, index revisions, queue, debounce/poll timers and independent scan/worker states |
| `ExportEditingService` | Insert/edit/configure dialogs, conversion, navigation and each dialog's insertion state |
| `ExportMaintenanceService` | Migration, rename/deletion, live-reference cleanup, cleanup revision, write count and deletion guards |

The facade owns one lifetime controller and passes a read-only abort signal.
Refresh uses mutually exclusive `Idle`/`Running`/`Stopped` worker states; scans
have an independent `Idle`/`Running` state so indexing and refreshing can overlap.
Shutdown is terminal and a delayed layout callback cannot restart polling.

Maintenance exposes `withWrite()` to protect in-progress definition/note changes
from cleanup. Nested or overlapping operations release their own count in
`finally`; entering a write invalidates older cleanup snapshots. Other services
cannot mutate that count. Maintenance requests indexing/source invalidation
through narrow callbacks and reads existing bindings through a read-only view;
the index and scheduling maps remain owned by refresh. Configuration queues and
Sync ordering remain in `ExportDefinitions` and `ExportReflection`.

The framework-free table form is maintained upstream in
`csvzall/src/viewer/modules/table-form.mjs`. The native viewer mounts it inside
its existing chart dialog; `TableModal` mounts the same module inside an
Obsidian Modal. Hosts provide column discovery, preview and submit callbacks.
The shared form owns all/columns/SQL modes, validation, preview and form state.

After editing the upstream form, run `node scripts/sync-table-form.mjs` in this
repository and review the imported source. `node scripts/sync-table-form.mjs
--check` verifies equality after normalizing source line endings to LF when both checkouts are available. Both builds
ship local copies; the plugin build does not require a sibling checkout.
Keep `src/markdown/table-form.d.mts` aligned with the public form interface.

Linked regions use short HTML comments. Table markers occupy full lines; value
markers can sit inside sentences. Both retain ordinary Markdown content with
the plugin disabled:

```markdown
<!-- csvzall:export open-tasks -->
| title | priority |
| --- | --- |
| Fix importer | 3 |
<!-- /csvzall:export open-tasks -->
```

## SQL code blocks

Table exports can use **Comment markers** or **SQL code block** in Insert from
CSV, Edit export, or Configure. The last insertion choice is remembered. Values
remain comment-only because fenced blocks cannot sit inside a sentence.
Changing syntax retains the update preference. Fenced queries share definitions
by resolved CSV source and SQL within the note folder's configuration scope.

Both `csvzall` and `sql csvzall` fence headers are accepted. Generated blocks use
`sql csvzall` so SQL is the highlighting language. Ordinary `sql` blocks and
examples inside longer fences, lists or blockquotes do not execute. Executable
export blocks are top-level and must have a closing fence.

For a handwritten block, quote a single note-relative CSV filename:

````markdown
```sql csvzall
SELECT Date, "KPIs Delivered"
FROM "Productivity Tracker.csv"
LIMIT 10
```
````

The SQL block stays clean: no IDs, metadata comments or output markers are
added. SQL in the note is authoritative. Paths may contain `..` within the
vault. Generated blocks replace the viewer's implicit `FROM data` with the
CSV filename relative to the note, preserving aliases and qualified columns.
Strings, comments and CTE names stay intact. Each export currently binds one
CSV source; a code block must name that source after FROM or JOIN. Queries
without a source can use comment syntax.

Results are actual Markdown tables immediately after the code block, with no
output comment markers. Refresh skips whitespace only. If the adjacent table's
ordered headers match the result, it replaces that table. Other text stops the
search. Missing or mismatched headers insert a new table below the block and
preserve the old content, so changing the schema may leave two tables.

Identical queries against the same resolved CSV share a saved definition and
automatic-update preference within their configuration scope. Each occurrence
updates its adjacent matching table. Different note folders may resolve the
same relative filename to different CSVs. Editing the SQL selects a different
query; previous query metadata cannot overwrite the note's SQL. Reordering or
copying identical blocks needs no per-block identity. An unchanged scan does
not write definition revisions.

Definitions use the existing reflected configuration and Sync deletion safeguards.
A delayed clean block cannot automatically recreate an explicitly deleted query;
explicit insertion can enable it again. Incomplete typing postpones cleanup and
preserves previous output. Metadata from the earlier development build is read
once to preserve its source and pause preference, then removed from the note.

Automatically discovered definitions carry `csvzallDefaultPreferences: true` in
configuration and receive provisional revision priority. Later durable choices
arriving through Sync win over these defaults, including after rename/recovery.
Explicit preference changes remove the flag. External edits to a provisional
entry also become durable, even when the editor preserves unknown fields.
Explicit edit/conversion actions validate their note snapshot before replacing
a selected occurrence; background refresh still preserves unrelated prose edits.

## Insert a tested query into a note

After a successful query in the hosted native viewer, **Insert into note** opens
the insertion dialog. **Choose note** searches Markdown notes by their full
vault paths. Select syntax and automatic updates, then insert. The export is
appended to the selected note, which opens in a tab; an already-open editor's
unsaved text is preserved. Source paths are computed relative to that note.

Changing the query or a failed run disables insertion until a successful rerun.
For unsaved CSV edits, the action reads **Save and insert into note** and waits
for the viewer's persistence acknowledgment. Cancellation, failed saves and a
closed/replaced source viewer do not authorize insertion. Export execution uses
the full query, including an explicit `LIMIT`, rather than displayed/sorted
result-grid rows. Standalone and Lite viewers do not expose this desktop action.

`ExportDefinitions` stores sources, selected columns and SQLite queries in
`.csvzall/exports.json`, alongside the existing charts configuration:

```json
{
  "exports": [
    {
      "id": "open-tasks",
      "format": "table",
      "input": "Data/tasks.csv",
      "output": "Reports/tasks.md",
      "runOnSave": true,
      "options": {
        "columns": [],
        "sql": "SELECT title, priority FROM data WHERE status = 'open'"
      }
    }
  ]
}
```

A value uses the same markers without introducing newlines. A standard inline
`<span>` keeps Markdown escaping active even at the start of a line (where a
leading HTML comment would otherwise create a raw HTML block):

```markdown
There are **<span><!-- csvzall:export open-count -->7<!-- /csvzall:export open-count --></span>** open tasks.
```

Set `format` to `"value"` and use a query such as
`SELECT COUNT(*) FROM data WHERE status = 'open'`. The query must return exactly
one row and one column, otherwise the previous content stays in place. A NULL
or empty cell renders as empty text. Value generation captures CSV strings
rather than JSON numbers to preserve large integers exactly, and requests at
most two result rows to detect invalid shapes. ASCII punctuation is escaped
for Markdown; HTML, links, entities and comment delimiters stay literal.
Control characters and line breaks become spaces so values remain inline.
The shared form exposes the format choice only when its host opts in; the
native chart-table form continues to offer table exports. The bundled CommonMark
parser identifies code blocks, including those inside lists and quotes; rendered
Markdown tests cover scalar escaping in standalone and inline positions.

The form writes definitions automatically. `format` defaults to `"table"`. `sql` and `columns` default to an
empty query and all columns; `runOnSave` defaults to true. Setting it to false
pauses automatic refresh while retaining the manual refresh command. `output`
records the original destination; markers bind tables by ID, so copies of a
note within the same configuration scope can share a definition. Editing a
fenced query selects a different shared definition. Comment exports retain their
existing ID-based copy behavior. Unchecking **Keep updated** retains the query and manual
refresh for both syntaxes. The explicit **Stop automatic CSV export updates**
action detaches the export and preserves static Markdown. Unused linked
definitions are cleaned up with the existing Sync safeguards.

Like charts, nested configurations are supported, for example
`Project/.csvzall/exports.json`. Input and output paths are relative to `Project`,
with `..` allowed only within the vault. Each note uses its own folder's
configuration. Legacy inherited definitions are localized automatically before
use, retaining relocation history for staged Sync and late notes.
IDs must be unique within a configuration and within each note. Unknown config
fields are preserved. Invalid configuration is never silently overwritten.

On startup and when notes are indexed, legacy URI-encoded recipes and short
`csvzall:table` markers migrate to `csvzall:export`. Legacy `.csvzall/tables.json`
files are merged into `.csvzall/exports.json` with the `exports` array and
`format: "table"`. All entries and metadata are preserved, including definitions
not currently used by a note. The original file is retained as `tables.json.bak`
(or a uniquely named backup if one already exists). Configuration writes are
staged and verified before archiving the old config or changing note markers.
Existing tables and surrounding prose are preserved byte-for-byte during marker
migration. Conflicts get a separate ID; `legacyTableId` records the origin of migrated entries and binds old table markers
to their migrated definition until the markers are updated. Failed writes retain
legacy instructions. Non-export code fences, indented code and inline code
examples remain inert. Malformed, nested, duplicate or mismatched regions are
never rewritten.

Refresh is one-way. It is debounced, serialized, runs on startup and source
changes, and discards results when a source or configuration changes during a
query. Hidden configuration files are checked every ten seconds and on CSV
saves. A replacement verifies the original region still matches, preserving
edits made while the query ran. Open editing buffers use editor replacements;
closed notes use Vault.process. Unchanged output is not written. Missing or
invalid definitions and failed queries retain the previous table, with repeated
identical errors deduplicated. Moving a note to another vault requires its CSV
and table definition as well as updating paths where necessary.

The helper runs SQL as a SELECT subquery and returns Markdown or CSV on stdout, without
shell interpolation. Preview limits the result to 20 rows. Captured commands
wait for stdout EOF, decode UTF-8 across chunks, cap output at 16 MB and time out
after 60 seconds. Large exports should use a query to reduce output.

Manual verification uses `demo-vault/Table export demo.md`: change a source
row, confirm the generated table updates while prose remains, edit its query,
then check the inline open-task count and stop updates to confirm that content
becomes ordinary editable Markdown.
Check both shared form hosts after form changes.
