# Bundled desktop helpers and release preparation

The desktop plugin includes three Obsidian-specific native helpers in `main.js`.
Obsidian installs only `main.js`, `manifest.json`, and `styles.css`; no separate
helper download or install is needed. Lite remains independent of native helpers.

The plugin bundling stage verifies the pinned archives and executable hashes,
then stores identical embedded viewer text once across platforms. Each Brotli
helper payload contains its remaining bytes and a compact reconstruction recipe;
the shared text has its own Brotli payload. It uses Node's built-in compression
support and does not rebuild native code. The installer decodes only the shared
text and selected platform's payload, reconstructs the exact original executable,
and verifies its executable hash before writing. Text detection does not depend
on native symbol tables, platform binary formats, or a particular viewer layout.
Archive hashes still identify installation directories, preserving existing
installations across this packaging change. The native archives, receipts, and
build identity remain independent of this JavaScript payload representation.

## Source and build identity

`native-binaries/build.json` pins the csvzall source commit and version, every
compiled dependency's commit, CMake/Python/Ninja versions, target runner labels,
and CMake configuration. Windows x64, macOS arm64, and Linux x64 are supported.
The macOS recipe targets macOS 13.3 or later. Linux uses GCC 14; Windows uses
Visual Studio 2022. The build verifies all three upstream source version markers.

IPO (link-time optimization) is enabled only for Linux, where local measurements
reduced the compressed helper payload. Windows measurements increased its size;
Windows and untested macOS keep IPO disabled. Linux sets CMake policy CMP0069 to
NEW so older dependency projects, including SQLiteCpp and SQLite, also use IPO.
These settings are part of the build identity and require a newly prepared
helper snapshot before release.

The build identity hashes that complete configuration and the native workflow,
build, packaging, and verification scripts. It excludes plugin-only changes.
The dependency checkouts are explicit, and CMake's FetchContent network fallback
is disabled. Obsidian builds disable PostgreSQL, keychain, and compressed input;
upstream's runtime dependency guard rejects non-system shared libraries.

Build ownership lives here. csvzall's release workflow publishes its full CLI and
WASM assets without duplicating Obsidian native jobs. A standalone csvzall release
is not required to ship a new plugin helper; its source commit must be published.

## Prepare, review, then publish

1. Commit the desired `build.json` pins and set the intended desktop plugin
   version in its normal metadata files. Keep the helper's version consistent
   with the three version markers at the pinned upstream source commit.
2. Run **Release** manually on that branch with operation **prepare** and the
   intended plugin version as **tag**. This calls `build-obsidian-helpers.yml`.
3. If the committed helper manifest has the same build identity, every archive
   checksum is verified and all three native jobs are skipped. Otherwise each
   platform restores an exact-key candidate or compiles its pinned sources.
4. Cached candidates must pass provenance, archive checksum, extracted executable
   checksum, architecture, CLI version, and local viewer HTTP startup checks.
   Fresh builds pass the same checks before entering the cache. There are no
   partial-key fallback restores. Corrupt candidates fail rather than ship.
5. Preparation collects all three results, updates the helper manifest and
   archives, removes superseded archives, rebuilds `main.js`, runs desktop/mobile
   tests and a clean source-archive build, and opens a preparation PR. If the
   selected commit already has the exact snapshot and bundle, no PR is needed.
6. Review and merge that PR, then tag the release commit. The tag-triggered
   publication verifies the committed build identity and archive hashes, tests
   and attests the plugin, and publishes the standard three Obsidian files.
   Manual **publish** can retry an existing tag. It never rebuilds native code
   or rewrites a tag's source snapshot.

The Actions repository setting must allow GitHub Actions to create pull requests.
The default `GITHUB_TOKEN` can create the preparation PR, but its pushes do not
trigger other workflows. Preparation already runs all checks before opening the
PR. If branch protection requires PR-triggered checks, configure
`RELEASE_PREPARATION_TOKEN` with an appropriately scoped GitHub App or repository
token; the preparation checkout/push/PR uses it when available.

The generated snapshot is committed before tagging so a clean GitHub source
archive contains exactly the bytes bundled into the release. After `npm ci`,
ordinary plugin builds need neither Git, a native compiler, nor helper downloads.
The initial imported 0.5.0 archives had no source-build receipt. The first
preparation rebuilt all three and froze the verified 0.6.0 snapshot for desktop
0.5.0; subsequent releases reuse it while the source and recipe remain unchanged.

## Local inspection and maintenance

```sh
node scripts/native-helper-contract.mjs plan
npm run check:helper-snapshot
npm run check:bundled-helper
npm test
npm run check:source-archive
```

`node scripts/bundle-native-payloads.mjs` regenerates only the ignored TypeScript
payload data. It needs neither Python nor a native toolchain. Production builds
run it automatically; `check:bundled-helper` verifies the embedded Brotli
payloads against the pinned executable hashes.

`check:helper-snapshot` requires a prepared snapshot matching the current recipe;
the offline production build also accepts the initial checksum-pinned import.
`npm run sync:bundled-helper -- <snapshot-directory>` imports a complete verified
snapshot downloaded from the preparation workflow. It does not contact upstream
releases. On a matching platform with the declared tools installed,
`node scripts/build-native-helper.mjs build <target> <output-directory>` runs the
same build and smoke checks locally. `verify` rechecks an existing result.

Update the third-party notices when dependency licenses change. Native library
notices are included in the desktop bundle banner. Keep native archive files
marked `-text`; never normalize their bytes or change hashes to hide corruption.

## Runtime selection and custom executables

Startup verifies and extracts only the matching bundled archive into
`csvzall-bin/<helper-version>/<platform>-<arch>-<digest>/`. Missing or damaged
files are repaired. Unchanged executables are not rewritten; older directories
are retained so upgrades do not disturb running processes. Unix executables get
executable permissions. An unsupported architecture can use a compatible custom
executable; it never silently receives a different architecture's helper.

`csvzallExecutableMode` is either `bundled` or `custom`. Default settings and
recognizable legacy managed downloads migrate to bundled mode. Existing custom
paths and explicit custom PATH commands are preserved. Bundled paths are resolved
again after a vault is moved or synced to another platform. The settings action
**Use bundled helper**, or clearing the custom path, switches back and repairs
bundled files. Custom binaries remain independently managed.
