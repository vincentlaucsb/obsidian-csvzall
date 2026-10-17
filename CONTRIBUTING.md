# Contributing

Use Node 20.19+, 22.13+, or 24+ and install the lockfile dependencies:

```powershell
npm ci
npm run dev
```

Read [AGENTS.md](AGENTS.md) for module ownership, Git synchronization, supported
Obsidian APIs, and desktop/mobile constraints. Keep text files in LF format.
Use the canonical [demo vault](docs/demo-vault.md) for local testing and keep
machine-specific configuration and plugin installations untracked.

Before proposing changes, run `npm test` and review the diff, including the
regenerated desktop `main.js`. See [regression testing](docs/testing.md) for
validation appropriate to the change. Do not edit generated WASM JavaScript;
use the [viewer refresh workflow](docs/wasm-viewer-refresh.md).

For Obsidian review feedback, run the
[warning remediation workflow](docs/obsidian-warning-remediation.md). Maintainer
guidance belongs in `docs/` or `AGENTS.md`; the README is for plugin users.

The shared chart options form is synchronized from the sibling csvzall source
with `node scripts/sync-chart-form.mjs`; use `--check` to check for drift.
Mobile distribution guidance lives in [mobile distribution](docs/mobile-distribution.md).
Release asset packaging is defined in `.github/workflows/release.yml`.
