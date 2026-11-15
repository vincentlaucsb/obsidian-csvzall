# Desktop 0.11.0 preparation

This is a local release candidate, not a published release. Public tags and
releases were checked on 2026-11-15: the latest desktop release was 0.10.2,
and 0.11.0 had no public tag or release. Desktop metadata targets 0.11.0;
Lite retains its independent version.

## Scope

- #28: initialize fresh plugin data without failing before registration.
- #29: bound background export discovery and remove whole-vault startup work.
- #33: keep healthy exports working when another export's CSV is unavailable.

The native helper build identity is unchanged. Its three-platform snapshot
and executable payload checks passed; preparation can reuse the pinned helper
without compiling new native binaries.

The dependency audit found a minimatch advisory in the lint toolchain. A
targeted override updates affected major versions 7–10 to 11.0.1, retaining
the unaffected version 3 consumers and the Moment override. The updated
lockfile installed successfully and reported zero vulnerabilities.

## Validation

All automated release checks passed on the completed source:

- Desktop: 369 tests passed, zero failures or skips.
- Mobile: 14 tests passed; reused after desktop-only follow-up changes.
- Lint and both distribution type checks passed through the builds.
- Clean source-archive npm ci and production build passed without .git.
- Native snapshot and bundled executable integrity checks passed.
- Dependency audit: zero vulnerabilities.
- Line-ending normalization changed no files; git diff --check passed.
- Desktop manifest, package, lockfile and compatibility map agree on 0.11.0.

Logs and the installation ZIP are under ignored .test-build/release-0.11.0/.
The regression plan includes complete empty-vault startup, a populated vault
without CSVs, bounded discovery and unchanged polls, first-save races,
mixed healthy and missing SQL sources, pause state, targeted refresh, and
recovery after a missing source arrives.

Current official [Sync settings](https://obsidian.md/help/sync/settings),
[developer policies](https://docs.obsidian.md/community-directory/developer-policies),
[submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins),
and [plugin guidelines](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Plugins/Releasing/Plugin%20guidelines.md)
were reviewed on 2026-11-15. The storage format, active-profile boundaries,
desktop capabilities, and minimum app version remain unchanged.

The pre-existing demo-vault edits are outside this release's changes. The
pre-existing generated bundle was backed up under the ignored
`.test-build/release-0.11.0/main.before.js` before rebuilding.

## Remaining manual acceptance

Real Obsidian desktop and device Sync acceptance have not been run in this
preparation. Mocked service and actual-onload tests cover the integration
boundaries, and the suite exercises the bundled native helper locally.
Background hidden-configuration discovery advances in bounded polling batches;
previously undiscovered configurations in very large vaults can take multiple
polls to appear. Opening an affected CSV or preparing a note uses scoped lookup.

Issues #30, #31, and #32 are outside this candidate's requested remediation scope.
