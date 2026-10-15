# Markdown export integration

`src/markdown/MarkdownTableService.ts` owns note insertion, refresh scheduling,
source rename tracking and region updates. `src/main.ts` only wires the service
and commands. Mobile does not import this desktop service.

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
table through the form creates its own definition, leaving copies unaffected.
Stopping automatic updates removes the markers and preserves the static table.
Unused definitions remain in the configuration and may be removed manually.

Like charts, nested configurations are supported, for example
`Project/.csvzall/exports.json`. Input and output paths are relative to `Project`,
with `..` allowed only within the vault. A note searches its containing folder
and ancestors for the nearest definition with its ID. New definitions use the
nearest existing tables configuration, or create the vault-root configuration.
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
legacy instructions. Code fences, indented code and inline code examples remain
inert. Malformed, nested, duplicate or mismatched regions are never rewritten.

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
