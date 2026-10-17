# Obsidian release review: October 17, 2026

Published desktop 0.5.0 and csvzall Lite 0.2.0 from the reviewed working tree.
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

Publication verification:

- [Desktop preparation](https://github.com/vincentlaucsb/obsidian-csvzall/actions/runs/39058558766)
  built and smoke-tested all three platforms. Its verified snapshot was merged
  through [PR #10](https://github.com/vincentlaucsb/obsidian-csvzall/pull/10) before tagging.
- [Desktop publication](https://github.com/vincentlaucsb/obsidian-csvzall/actions/runs/39058970399)
  and the merged commit's unit and coverage checks passed. Publication verified
  the snapshot, ran tests and the source-archive build, and attested the assets.
- [Unchanged-source preparation](https://github.com/vincentlaucsb/obsidian-csvzall/actions/runs/39059027452)
  passed with native compilation skipped and no new preparation PR or commit.
- [Lite validation](https://github.com/vincentlaucsb/obsidian-csvzall-mobile/actions/runs/39058537207)
  and [publication](https://github.com/vincentlaucsb/obsidian-csvzall-mobile/actions/runs/39058591528)
  passed. Both plugins' latest stable releases expose exactly the standard three
  assets; downloaded bytes match their validated builds and version metadata.
- The exact Windows helper from preparation also passed a local checksum,
  architecture, version, and HTTP viewer startup check after publication.

Physical-device testing and a refreshed hosted scorecard for these versions are
not claimed; service-unavailable scans are not passing results.
