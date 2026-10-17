# Obsidian release review: October 17, 2026

Preparing desktop 0.5.0 and csvzall Lite 0.2.0 from the reviewed working tree.
The native helper source is pinned to csvzall 0.6.0, commit
`34bab618cbf91b78f016430fcff7c0c27805835e`. Native archives are frozen by release
preparation before the desktop release tag is created.

`npm run review:obsidian` retrieved current official guidance at revision
`c56c7e770ba25dd0ea392aacf4588f9425970d36` and seven public warnings. The public
scorecard still describes desktop 0.4.0 at
`ffdb85ab45f27676310c00eeb6c04f612bac271d`. The dispositions in
[the October 16 review](obsidian-review-2026-10-16.md) still apply: required
filesystem and process capabilities remain disclosed; type narrowing, scalar
sanitization, declarative settings, the Moment advisory, and source-archive
builds have been remediated. The official policies, submission requirements,
plugin guidelines, submission guide, and settings migration guide were read.

Local verification before release preparation:

- Desktop tests: 198 passed; mobile tests: 11 passed; upstream WASM tests: 32
  passed; compact-layout tests: 4 passed.
- Native CTest suites passed, including HTTP serving, embedded asset rebuilding,
  shared viewer state, and CLI smoke checks.
- Real-engine browser checks passed against source and the embedded bundle:
  portrait/landscape layout, explicit mouse/touch overflow activation, safe
  Insert/Delete submenus, stable editing focus, trailing scroll clearance,
  40-row CSV persistence, and standalone filename visibility.
- Type checking, lint, bundle checks, LF enforcement, and clean source-archive
  builds passed. `npm audit` on this run reports zero vulnerabilities, including
  development dependencies.
- Both plugin IDs remain registered to their existing GitHub repositories in
  Obsidian's community directory. Release tags and attached manifests must
  match their respective plugin versions.

Physical-device testing and a refreshed hosted scorecard for these unpublished
versions are not claimed. Public releases and hosted workflow results will be
verified after publication; service-unavailable scans are not passing results.
