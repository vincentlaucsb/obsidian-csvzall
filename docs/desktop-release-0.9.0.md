# Desktop 0.9.0 release

The user authorized pushing local `master` to `origin/main` and publishing
0.9.0 once tests pass. No separate Lite release is requested.

## User-facing changes

- Clean `csvzall` and `sql csvzall` code blocks produce ordinary Markdown
  tables, alongside the existing comment-based exports.
- The SQLite viewer can insert a tested query into any existing vault note,
  using CSV paths relative to the chosen destination.
- Both table syntaxes support the same automatic/manual refresh behavior.
  Pausing retains the query; inline values continue to use comments.
- Opening CSVs avoids repeated whole-vault scans and the engine-loading modal.

## Verified source

The plugin's CI-fixture and await-warning fixes are committed at
`986832ed03b432ec09bcd953d19cef525966706d`. Unit Tests, including desktop/mobile
builds and the source-archive check, and Codecov passed on that exact commit.
Local validation under `CI=true` also passed 322 desktop and 14 mobile tests.

The required upstream viewer changes were merged through
[csvzall PR #38](https://github.com/vincentlaucsb/csvzall/pull/38) after all ten
checks passed. Its 0.9.0 source markers agree at merged commit
`e101b3cd8c6b911a109eb8d7cfeb3fd55bf54c7b`, tagged and published as
[csvzall 0.9.0](https://github.com/vincentlaucsb/csvzall/releases/tag/0.9.0).
The [binary packaging run](https://github.com/vincentlaucsb/csvzall/actions/runs/39733947325)
passed and published Linux, Windows, macOS, and WASM assets. Obsidian helper
preparation compiled the same published, tagged source in parallel. Both
pipelines passed before plugin publication.

## Production helper snapshot

[Preparation run 39735259659](https://github.com/vincentlaucsb/obsidian-csvzall/actions/runs/39735259659)
passed all three platform builds, packaged-executable smoke checks, snapshot
collection, desktop/mobile tests, and the clean source-archive build.
[Preparation PR #22](https://github.com/vincentlaucsb/obsidian-csvzall/pull/22)
froze the helper archives and production bundle at
`83c38b0b09973cc9b4eb9e08d495a2840472cadb` and merged as
`cda992c2540b0910c191d71c6a0e7b356a715792`.

All three receipts match source commit
`e101b3cd8c6b911a109eb8d7cfeb3fd55bf54c7b` and build identity
`474d25f2a55ea9222662e3c6db0275aa2664a3b7a3031dc9bb3f46a8ce4e6cee`.
The Windows CI archive independently passed local extraction, architecture,
version, Obsidian acknowledgment, hosted save, and explicit chart smoke checks.
Bundle inspection confirmed every pinned payload and no development marker.

| Asset | SHA-256 |
| --- | --- |
| Linux helper archive | `2371b7d1161a4aaeb668e4a0669de7a291db09df95626013711f131410a016bd` |
| macOS helper archive | `11a38a16331feb2bc4e360523b06624dcb388fb388424f5036ae1e33217cc3a8` |
| Windows helper archive | `7036e98da8e3e8991a222a37a83b4c1bee56bac63db008cb2b46c3c397bf99d3` |
| `main.js` | `c8f25ab81bcf8c7fc22b8b32aa819fd336e05054c4a8a51a62e86f551db93dfb` |
| `manifest.json` | `a492801a07dcadbb2cb02fe36cb476a7de31832d105e84cc1d499f7ddd864a1e` |
| `styles.css` | `bdc8f24de90882338d7154d0cd447963819f78f027dc056c7e88cd6a9285b914` |

The embedded viewer was refreshed from the same clean released source. Its
JavaScript bytes retained SHA-256
`2f7328eeb41a1ccbc8d8893cb286e86d03057f66ffa11028a7121f05776e1800`;
desktop/mobile tests passed again after the refresh.

## Publication

Final plugin commit `b13f2a0e063ad0800a9379a244f26d83b1ee89d2` passed
[Unit Tests](https://github.com/vincentlaucsb/obsidian-csvzall/actions/runs/39736166193)
and [Codecov](https://github.com/vincentlaucsb/obsidian-csvzall/actions/runs/39736166203)
before it was tagged as bare `0.9.0`.
[Publication run 39738031955](https://github.com/vincentlaucsb/obsidian-csvzall/actions/runs/39738031955)
passed metadata and frozen-snapshot verification, desktop/mobile tests, bundled
helper inspection, the clean source-archive build, and release attestations.

[Plugin 0.9.0](https://github.com/vincentlaucsb/obsidian-csvzall/releases/tag/0.9.0)
is published as the latest release with the three standard Obsidian assets and
a user-facing summary of SQL block exports, insertion into notes, update
controls, and faster, quieter startup. Downloaded assets exactly match the
verified source hashes above. The production Windows helper independently
served the new note-insertion module, export syntax controls, and quiet startup
assets over its authenticated local server.

Vince's Notebook now links its three plugin artifacts to this checkout's
verified production outputs. Settings hashes matched before and after the
change. Reload the plugin to activate the release build. No separate Lite
release was published. The hosted scorecard has not been reverified against the
new tag; local validation does not establish hosted warning clearance.
