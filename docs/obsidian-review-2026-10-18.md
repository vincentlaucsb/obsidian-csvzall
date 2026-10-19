# Obsidian warning remediation: October 18, 2026

Reviewed the [csvzall scorecard](https://community.obsidian.md/plugins/csvzall#scorecard)
retrieved at `2026-10-19T01:29:23.810Z` (October 18 in America/Phoenix).
It covers desktop **0.6.0**, source commit
`75df51642efa03da2ca7cbba6068fe063a567ec2`, matching the checkout's starting
commit and release tag. It reports eight warning occurrences in seven groups,
three Other occurrences in two groups, and three separate disclosures.

The five official guidance documents were freshly downloaded and read:
developer policies, submission requirements, plugin guidelines, submission
guide, and declarative settings migration. Their pinned documentation revision
is `c56c7e770ba25dd0ea392aacf4588f9425970d36`. Source URLs, normalized hashes,
raw page, findings, and completion marker are in ignored
`.test-build/obsidian-review/`. Collection followed the
[remediation workflow](obsidian-warning-remediation.md).

## Findings and dispositions

| Published finding and location | Disposition and change |
| --- | --- |
| Unbound methods, `src/settings/exportActions.ts:10–11` (two warnings) | Fixed. Arrow callbacks call methods on their `actions` receiver. Regression coverage uses methods that depend on `this`, and both runtime distributions now enforce `unbound-method`. |
| Unnecessary assertion, `src/obsidian/settingsModal.ts:12` | Fixed. Removed the redundant assertion after the object guard; private settings methods remain checked before use. Enforce `no-unnecessary-type-assertion`. |
| `!important`, `styles.css:221` | Fixed. Host display rules exclude hidden elements and the final `[hidden]` rule uses normal specificity. |
| `:has`, `styles.css:165` | Fixed. Removed the obsolete settings-row rule: the export list now lives directly in its own view. |
| `main.js` exceeds 5 MB | Retained packaging limitation, now disclosed in README with per-desktop installation guidance for Obsidian Sync Standard. The three verified native archives total 6,025,173 bytes before base64 encoding, so the existing offline multi-platform helper payload alone exceeds the limit. Keep the pinned offline installation design and document the limitation rather than remove platforms or restore runtime downloads. |
| Direct Filesystem Access | Required desktop capability. Reviewed bundled materialization and real-path handling: archive hashes are verified, managed paths reject symlinks and invalid filenames, and writes use temporary files. Existing README disclosure remains. |
| Shell Execution | Required desktop capability. `CsvzallProcessService` launches executable paths and separate argument arrays with `spawn`, without shell interpolation; cancellation, timeout, and process cleanup remain. Desktop retains `isDesktopOnly: true`; mobile remains free of Node/Electron dependencies. |
| Deprecated `setWarning`, `src/settings/ExportModals.ts:96` and `src/settings/exportActions.ts:11` (two Other occurrences) | Fixed. Use `setDestructive()`, available since Obsidian 1.13.0, already the desktop minimum. Enable `no-deprecated`; update button mocks while retaining confirmation, failure, and retry coverage. |
| Vault Enumeration (Other) | Required for CSV discovery and export indexing. Retained; no scanner bypass or API concealment. |
| External-domain disclosure (`github.com`) | Retained. README explains local operation and outside-vault access; the helper is bundled, not downloaded at runtime. GitHub links include explicit user actions such as reporting a bug. The viewer documentation action opens only its fixed documentation page. |
| Malware and network-request scans unavailable | Service limitations. Neither is recorded as passing. |

The hosted scorecard separately reports seven passes, including dependency
scanning, artifact attestations, no obfuscation, and byte-for-byte build
reproduction. These describe published 0.6.0, not the unshipped changes here.

## Workflow and recurrence prevention

The repository-local `obsidian-warning-remediation` skill and its reference
document now explicitly permit shortening, deduplicating, and grouping existing
rules under more general rules while preserving scope, requirements,
exceptions, and validation duties.

Consolidated the overlapping minimum-version rules in `AGENTS.md` and removed
the duplicate desktop-only reminder, whose requirement remains in the
capability rule. Grouped native UI styling requirements with semantic delete
buttons and layout selector constraints. Added concise callback/type/deprecation
requirements to the type-safety gate and documented the enforced lint rules.

This run also found a collector failure: warning badges count occurrences,
while repeated messages are grouped. The collector now retains each group's
count, validates positive integer counts, and compares the sum of warning
occurrences with the advertised total. Regression tests retain source locations
and reject missing occurrences; no page scripts are executed.

Enabling `unbound-method` exposed three intentional captures in
`CsvzallTableView.patchLeafNavigation()`. They preserve original method identity
for restoration and explicitly call each method with `.call(leaf)`. A documented
exception covers only those captures; unsafe-value checks remain enabled.

The shared table form is imported from csvzall and must match upstream exactly.
An attempted extension of the CSS cleanup to that module failed its equality
check and was removed with `node scripts/sync-table-form.mjs`. Its existing
injected `:has()` and `!important` styles remain unchanged; they are outside
the published stylesheet findings. Changing them requires the upstream source
and dependency workflow, not a local divergence or weaker equality assertion.

Desktop patch metadata is synchronized at **0.6.1** in `manifest.json`,
`versions.json`, `package.json`, and both lockfile version locations.
The minimum remains **1.13.0**. Mobile metadata and native helper pins are
unchanged. No release tag or publication is part of this run.

## Validation

- Skill validation: passed.
- `npm run fix:line-endings`: zero files required normalization; imported assets
  retain their upstream bytes.
- `npm run lint`: passed with zero warnings after documenting the intentional
  navigation method captures.
- Focused scorecard, export-modal, and settings tests: 18 passed, including
  receiver-dependent callbacks and grouped warning completeness checks.
- Browser CSS checks: passed in headless Chrome at 480px and 1280px for bar,
  heatmap, and Markdown chart options, including fixed/rolling range changes.
  Every hidden control retained `display: none`; standalone table forms kept
  their checkbox row layout and hid optional fields. The imported table form's
  own styles are unchanged.
- `npm audit`: zero vulnerabilities, including development dependencies.
- `npm test`: all 207 desktop and 11 mobile tests passed, including both
  production builds, bundle checks, lint recurrence tests, source equality,
  navigation protections, and installer behavior.
- `node scripts/sync-table-form.mjs --check`: passed.
- `npm run check:source-archive`: passed on the final source tree after fresh
  `npm ci`, without `.git` or inherited dependencies. The check removed its
  temporary archive. npm reported a deprecated transitive ESLint release and
  an unapproved esbuild install script; dependency installation and production
  build still completed successfully without changing script-approval policy.
- Final LF, diff whitespace, evidence hashes, version metadata, and workflow
  reference checks: passed.

Initial sandbox runs could not access the network, initialize temporary Git
repositories, or rename installer test executables. Collection and browser
checks and the full suite passed after rerunning with the necessary access.
Those initial sandbox failures are not attributed to plugin defects.

Live Obsidian demo-vault and physical-device interaction checks were not run.
The browser form checks do not establish full Obsidian integration or device
behavior. Public warnings remain associated with 0.6.0 until a separately
authorized release and subsequent hosted scan verify the fixes. Filesystem,
process, and bundle-size warnings are expected to remain with this design.
