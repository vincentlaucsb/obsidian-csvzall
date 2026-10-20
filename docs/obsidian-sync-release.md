# Export Sync release log

Authorized on 2026-10-19 after Windows device testing. Release versions:
csvzall 0.8.0 and obsidian-csvzall 0.8.0, both minor releases because the upstream
adds a public CLI flag and viewer capabilities and the plugin introduces reflected
storage and automatic direct-folder migration. csvzall Lite is not being released.

The upstream release PR is
[csvzall #37](https://github.com/vincentlaucsb/csvzall/pull/37). It includes the
existing 0.8.0 viewer improvements plus the tested Obsidian mode integration.
The plugin must pin the merged, published upstream source before preparing its
three-platform helpers. Production release assets must have no development marker.

## Upstream

PR #37 passed all ten checks, including native tests on Windows, macOS, Linux,
Linux with compressed input disabled, WASM, coverage, version markers, and
incremental viewer assets. The integration review found no actionable priority
findings and independently passed 26 shared-viewer JavaScript tests.

The PR merged at `145101bccaed1911a8d031f950f02f1bb65e59fe`. All three source
version markers matched the bare `0.8.0` tag before it was pushed. The
[csvzall 0.8.0 release](https://github.com/vincentlaucsb/csvzall/releases/tag/0.8.0)
is published. Its
[asset workflow](https://github.com/vincentlaucsb/csvzall/actions/runs/39379045557)
passed all jobs and published Windows, macOS, Linux, and WASM archives, plus the
WASM checksum. The plugin now pins that exact merged and released source commit.

## Plugin

The [release PR #19](https://github.com/vincentlaucsb/obsidian-csvzall/pull/19)
contains the implementation, version metadata, and CI-prepared helper snapshot.
[Preparation run 39381644254](https://github.com/vincentlaucsb/obsidian-csvzall/actions/runs/39381644254)
passed all three native build/smoke jobs, snapshot collection, 266 desktop tests,
14 mobile tests, and the clean source-archive build. The prepared snapshot commit
is `3c60421926dfdea103546ebffe781a2830035fc3`.

The helper version is 0.8.0 at upstream commit
`145101bccaed1911a8d031f950f02f1bb65e59fe`. Its build identity is
`88d5d1e587632e186f0002b5b9044c7a3a43ade1d00200946987cde19d3e359b`.
All dependency pins remain unchanged. Desktop metadata agrees at 0.8.0 and
Obsidian 1.13.0; Lite remains at its independent 0.2.1 version.

Independent final review found no actionable P0/P1/P2 findings. Every archive
matched its CI receipt and extracted executable digest, contained exactly one
ordinary executable, and had the expected architecture. The reviewer decoded
all three payloads from actual production `main.js` and matched them to the
committed archives and CI snapshot. Development markers were absent. A separate
Windows runtime verification passed Obsidian acknowledgment, hosted save without
automatic charts, and explicit chart generation.

| Asset | SHA-256 |
| --- | --- |
| Linux helper archive | `cf8877198f8cd188d5100772c332e0c99dfb6c751589e84730592df8c5b03068` |
| macOS helper archive | `60e82de73e798cc358e87d4cb547fb8980a71ab8446706b1ca74c296ce33bfc8` |
| Windows helper archive | `9452dc8213eadd9422255f77a3a6669fa578d282f1261c256d26c6745f2cf4c8` |
| `main.js` | `c65ff033ca642c92c1a83889cd4a1c153fad842f84cee63da95e2d36b73c0b6f` |
| `manifest.json` | `e312128cf70488d3b8683e22e5f16dbb5c223d2c2bb214d5e3dd80e4d05580e9` |
| `styles.css` | `bdc8f24de90882338d7154d0cd447963819f78f027dc056c7e88cd6a9285b914` |

The prepared production files were installed into the local Notebook after backup
at `.test-build/notebook-before-release-0.8.0-20261019-234729/`, preserving
`data.json`. CLI verification initially selected the active Truck vault; no
production files were installed there. Opening Notebook by its registered URI
corrected the target, and the verification explicitly confirmed its filesystem
path. Notebook ran plugin 0.8.0 with direct-folder reflection ready, no pending
scopes, zero SQL/reflection errors, and a working Coding/Test.csv viewer. Sync
reported synced.

Merge only the green reviewed PR, tag the merge commit as bare `0.8.0`, and let
the publication workflow verify the frozen snapshot and publish attested assets.
The [plugin 0.8.0 release](https://github.com/vincentlaucsb/obsidian-csvzall/releases/tag/0.8.0)
and PR carry the final publication and merge state. Refresh the hosted scorecard
after publication; the pre-release review applies to 0.7.1 and is not evidence
that the new release has been scanned.
