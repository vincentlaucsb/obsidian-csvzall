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
has published Linux, Windows, and WASM assets; the standalone macOS package is
still compiling. Obsidian helper preparation can compile the same published,
tagged source in parallel. Both pipelines must pass before plugin publication.

## Remaining release gates

Finish upstream binary packaging, refresh the embedded viewer provenance, and
run the normal three-platform helper preparation workflow against the released
source pinned in `native-binaries/build.json`.
Review and merge its frozen helper snapshot only after validation succeeds.
Then tag the prepared plugin commit as 0.9.0, run publication, and verify the
published three standard Obsidian assets and their release notes.
