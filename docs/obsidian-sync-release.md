# Export Sync release log

Authorized on 2026-10-19 after Windows device testing. Intended releases:
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

Plugin release preparation and publication are in progress. The final PR, pin,
checksums, and outcomes will be recorded here before closing the task.
