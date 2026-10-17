# Obsidian warning remediation: October 16, 2026

Source: [csvzall Scorecard](https://community.obsidian.md/plugins/csvzall#scorecard),
retrieved October 16, 2026 (America/Phoenix). The listing reports desktop
release **0.4.0** and links source commit
`ffdb85ab45f27676310c00eeb6c04f612bac271d`. Review: Satisfactory;
seven warnings, with eight total issues including vault enumeration.
These are published-release findings, not results for the local 0.4.1 changes.

The [official documentation](https://github.com/obsidianmd/obsidian-developer-docs/tree/c56c7e770ba25dd0ea392aacf4588f9425970d36)
was downloaded at revision `c56c7e770ba25dd0ea392aacf4588f9425970d36`:
developer policies, submission requirements, plugin guidelines, submission
guide, and declarative settings migration. Raw scorecard details, source URLs,
retrieval time, and hashes are in ignored `.test-build/obsidian-review/`.
Repeat collection with the [workflow](obsidian-warning-remediation.md).

## Findings and dispositions

| Published finding | Disposition and local change |
| --- | --- |
| Direct Filesystem Access | Required desktop capability. Keep filesystem operations for native helper installation and real file paths; expand README disclosure of outside-vault helper use. |
| Shell Execution | Required desktop capability. Keep `child_process` for the native viewer, charts, and SQL. Existing launches use executable plus argument arrays without shell interpolation, and process lifecycle cleanup remains. |
| Cast to `TFile`, `MarkdownTableService.ts:133` | Replace the cast with typed collection destructuring and an `instanceof TFile` guard. Enable the official no-cast lint rule in desktop and mobile. |
| Control characters in regex, `managedTables.ts:155` | Replace the regex with C0/DEL code-point checks, preserving consecutive-control collapsing, Markdown escaping, and Unicode. Enable `no-control-regex` and exercise all control characters. |
| Deprecated settings `display()`, `SettingsTab.ts:32` | Remove the leftover override. Desktop already requires 1.13.0 and uses declarative definitions; redraw through `update()`. Enable the official lint rule for desktop and update settings tests. |
| Moment advisory | Obsidian's npm dependency pins Moment 2.29.4. Override it to patched 2.31.0 in package metadata and lockfile, covering both direct Obsidian types and the lint plugin's nested types. No extra runtime Moment is bundled. |
| Build verification failed | The published output fails on `git ls-files` because `.git` is absent. Add a filesystem-based LF scan for archives, retaining ignore rules and `-text` preservation. Add a clean `npm ci` + production archive build check to CI. |

The [Moment advisory](https://github.com/advisories/GHSA-4p3w-j4w9-5jqw)
affects versions from 2.29.2 through versions before 2.31.0. `npm explain moment`
confirms both dependency paths now resolve to 2.31.0. Additional audit findings
in development dependencies were fixed through compatible lockfile updates:
`brace-expansion` 1.1.21/2.1.7/5.0.12 and `fast-uri` 3.1.8.

Vault enumeration remains necessary for CSV discovery and linked note export
indexing. It is disclosed as Other in the scorecard. Three service disclosures
(malware scan, vulnerable-dependency scan, and build verification unavailable)
are recorded separately; their wording does not override the detailed build
failure. Do not label unavailable scans as passing.

Health also reports a missing contributing guide. Add `CONTRIBUTING.md` and
move existing maintenance/development instructions out of consumer README.
Document recurrence guards in `AGENTS.md`, the workflow, and testing guidance.
Desktop metadata is synchronized at **0.4.1**; mobile remains **0.1.2**.

## Validation

The checkout also contains the independently requested export settings feature;
validation covers the combined working tree.

- `npm run review:obsidian`: downloaded seven warnings and all five guidance
  documents; completion metadata and hashes written successfully. Extraction
  regression tests cover split records, source links, missing data, and warning
  count mismatches without executing page scripts.
- `npm run lint`: passed with zero warnings. Both production builds repeat
  the required type-safety gate.
- `npm test`: all **140** tests passed, followed by mobile build and mobile
  distribution validation at 0.1.2. Includes Git-backed and Git-free LF checks,
  lint recurrence guards, scalar control sanitization, and settings behavior.
- After the other chat's final root-folder correction, `npm run build` and
  test compilation passed again; both export-settings service tests passed.
  The generated desktop `main.js` includes that final correction.
- `npm run check:source-archive`: passed after fresh `npm ci`, without `.git`
  or inherited dependencies. Source selection now respects local/global Git
  exclusions when preparing the copy; the production check inside the archive
  uses the Git-free LF path. Temporary archive directories were removed.
- `npm audit`: **zero vulnerabilities**, including development dependencies.
- `npm run fix:line-endings`: no normalization needed. `git diff --check`
  passed; imported viewer assets and their recorded digest were unchanged.

Manual Obsidian demo-vault/device smoke checks were not performed in this run.

No release/tag or remote scorecard refresh is part of this run. A new release
and subsequent hosted scan are needed to verify public findings clear.
Direct Filesystem Access and Shell Execution warnings are expected to remain.
