# Automatic direct-folder export configuration

Status: implemented on local `master`, reviewed, and tested in the local Notebook
on 2026-10-19. Included in the [desktop 0.8.0 release](obsidian-sync-release.md).

Decision: each folder owns only its direct CSVs and export notes. The plugin
automatically migrates existing inherited definitions; there is no manual
consolidation action. This supersedes ancestor lookup in the original Sync plan.

Charts belong beside their source CSV. SQL table/value definitions belong beside
each referencing note. A definition shared across note folders becomes independent
local copies. An output-note path supplies an owner while its note is still
arriving; definitions with no note or output use their source CSV's folder until
a note reference supplies its own local owner. Root files still use root configs.
Relative input/output paths are rebased; source and generated files stay put.

Migration freezes old scoped reference resolution before making changes. IDs,
pause state, legacy bindings, unknown fields, document metadata and logical edit
times survive. Distinct identities collapsing onto the same folder/ID receive a
deterministic alternate ID; existing direct bindings remain authoritative.

Reflection records distinguish relocation from explicit deletion. Destination
records retain source lineage. All destinations must be durable and verified
before inherited file entries are retired. The journal, immutable Sync history,
and originals make interrupted retries safe. Older incoming ancestor records are
localized again without gaining a new edit timestamp; newer direct edits win.
Late notes can use relocation history, while explicit deletion remains final.

Runtime SQL lookup becomes local-only. Before a native viewer opens, the plugin
ensures a direct chart config exists so the CLI's unchanged nearest-config lookup
cannot select an ancestor. The standalone CLI retains its existing behavior.
Legacy tables.json migration remains supported before direct-folder localization.

Checks cover root/deep scopes, shared/late SQL references, ID collisions, unknown
fields, direct edits racing old-device imports, staged Sync, write failures,
rename recovery, repeated startup without timestamp churn, and a subfolder copied
into a new vault without its old ancestors. They also cover incomplete note scans,
legacy alias collisions before notes arrive, late references in the original
folder, and edited notes moving back to their original folder.

The final subagent review found no remaining actionable P0/P1/P2 findings and
independently passed all 99 focused reflection, SQL, and desktop-service tests.
The full suite passed 266 desktop tests and 14 mobile tests; the clean source
archive build and Windows bundled-helper integration checks passed.

After backing up configs and plugin data, the updated Windows bundle was installed
in the local `Vince's Notebook`. Three SQL definitions moved from the root config
to their note folders (two in Bike, one in Exercise); all nine chart definitions
remained beside their source CSVs. Reflection was ready with no pending scopes or
SQL/reflection errors. A native CSV viewer opened with `--obsidian`, Sync reported
synced, and repeated polling kept the revision count stable. Laptop acceptance is
still manual. The reflected descriptor now uses schema 2; update and reload the
test build on every participating device before editing exports there.
