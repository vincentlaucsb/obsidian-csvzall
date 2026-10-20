# Desktop 0.8.0 release review

The user authorized publication after testing export reconstruction, error
suppression, and automatic direct-folder migration. The release path is csvzall
0.8.0 followed by obsidian-csvzall 0.8.0. Native helpers must come from the
three-platform release-preparation workflow, not the Windows development bundle.

## Current official evidence

`npm run review:obsidian` refreshed the public scorecard and all five official
guidance documents. The completion marker records documentation commit
`9c28669aad4325a4f98dff6b67ab3c920261ad6f`. The retrieved scorecard applies to
published plugin 0.7.1, not the new release candidate.

- Bundle over 5 MB: acknowledged limitation documented in README and AGENTS;
  no additional Sync Standard accommodation is part of this release.
- Direct filesystem access: required to verify, materialize, and launch the
  offline native helper. Keep the capability and desktop-only manifest.
- Shell execution: required for native viewing, chart generation, and SQL.
  Executables and argument arrays remain separate; no shell interpolation.
- Vault enumeration under Other: used for chart scheduling, SQL references, and
  migration. Direct path lookups remain direct; no deprecated-method notice was
  present in the refreshed evidence.
- External-domain disclosure: legacy downloader sources remain outside the
  desktop runtime dependency graph. The desktop uses its embedded helper and
  local authenticated viewer. README discloses offline operation and required
  filesystem access; no new external service is introduced.
- Malware and network-request scans are unavailable on the public scorecard.
  Their absence is not a clean result for those scans.

The scorecard reports reproducible main.js, artifact attestations, no vulnerable
dependencies, and no obfuscation for 0.7.1. These are historical results; the new
release must pass its own pipeline. The current lockfile audit found zero
vulnerabilities. Desktop settings retain declarative definitions and Obsidian
1.13.0 minimum; mobile metadata and its Node-free runtime remain separate.

## Source and local validation

The final implementation passed 266 desktop tests, 14 mobile tests, required
type/lint/build checks, and a clean source-archive build. LF normalization changed
zero files and whitespace checks passed. An independent subagent found no
remaining actionable P0/P1/P2 findings, reran all 99 focused plugin tests, and
verified the Windows development package checksums and release rejection guard.

The local Notebook migrated three SQL definitions beside their notes while
retaining all nine charts. Every field and resolved input/output path in those
SQL definitions matched the backed-up originals. Reflection was ready, had no
pending scopes or SQL/reflection errors, and kept its revision count stable
across polling. Its native viewer acknowledged `--obsidian`; Sync reported synced.
The user had also confirmed config reconstruction and no errors on the laptop
with the preceding Windows test package. These are distinct acceptance checks.

The combined upstream release head `48d68e1c61fe7d03a8c1c6e724c5e69cd860d0e6`
received an independent clean review. All three csvzall version markers agree at
0.8.0. The reviewer independently passed 26 relevant shared-viewer JavaScript
tests and verified the flag leaves CSV Options, chart previews, explicit chart
actions, standalone save automation, and mobile UI policy intact.

See the [release log](obsidian-sync-release.md) for PRs, final pins, pipeline
results, publication, and post-publication scorecard status. Do not claim hosted
warnings cleared until the scorecard identifies the new release and commit.
