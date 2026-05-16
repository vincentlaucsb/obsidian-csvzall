# csvzall Obsidian Plugin

Experimental Obsidian integration for `csvzall`.

The plugin is intentionally thin: it launches the local `csvzall` helper
process, asks it to serve a read-only CSV viewer, and embeds the local URL in an
Obsidian pane.

## Development

```powershell
npm install
npm run dev
```

For local testing, place or symlink this folder under:

```text
<Vault>/.obsidian/plugins/csvzall/
```

Then reload Obsidian and enable the plugin.

## Expected Helper Protocol

The plugin launches:

```powershell
csvzall view <file.csv> --no-open --startup-json
```

The helper prints either a localhost URL or JSON containing a `url` field on
stdout. The plugin accepts both, but JSON is preferred.

Each open csvzall pane owns one helper child process. Closing the pane or
unloading the plugin kills the matching process. If Obsidian itself crashes,
helper processes may survive until cleaned up manually; that is acceptable in
this MVP.

## Scope

- Desktop only.
- Read-only MVP.
- No save endpoint.
- No bundled binary downloader yet.
- Local helper should bind to `127.0.0.1` and use a session token.
