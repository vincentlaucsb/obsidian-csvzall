# Use csvzall with an agent

On desktop, open csvzall settings and select **Agent integration → Enable or
repair**. The settings description lists the three skill files this installs.
The integration uses the bundled helper even if you configured a custom
executable for the viewer. Your custom setting is preserved.

Select **Test connection** to verify the prepared binary's checksum and run its
help with PATH empty. No global csvzall installation, Node, Python, or MCP server
is required.

Open a new agent chat with the vault root as its working folder, then ask:

> Use csvzall to query sales.csv and tell me total sales by product.

The skill directs the agent to the exact prepared binary and its command help.
The bundled helper supports viewing, SQL queries, and configured charts; it does
not include every command from the full standalone csvzall CLI.

## Client setup

- **Obsidian Copilot:** Use desktop Agent Chat. The skill appears in **Settings →
  Copilot → Skills** through its native agent directories. Check the desired
  agents are enabled. Start a new chat or reload its changed settings.
- **Claude Code:** Start in the vault root. The skill is available automatically
  or through `/csvzall`. Claude Code still needs its own sign-in.
- **Codex:** Open the vault root as the local working folder. The skill is
  available automatically or through `$csvzall`.

The agent's normal execution permissions still apply. Discovery does not grant
permission to execute native binaries. If execution is blocked, approve the
specific helper command through the agent's normal permission flow. Do not
disable sandboxing globally. Remote agents need access to the local vault and
binary; mobile and WSL execution of the Windows helper are not supported.

## Updates and removal

Each device needs its own **Enable or repair** setup after the desktop plugin is
installed. Hidden skill directories and native helpers are not assumed to sync.
After setup, local helper updates refresh the locator when the plugin loads.
Open Obsidian after an upgrade before using the new helper. Prepared commands
can also run while Obsidian is closed.

Skills use relative paths, including the active configuration folder. Do not move
the skills to another vault or change profiles without reconfiguring them. A
second profile will report a conflict instead of taking over existing skills.

**Remove** disables local automatic refresh and removes only unchanged files
installed by this integration. It preserves notes, CSVs, generated charts, helper
binaries, and extra files you added to skill folders. Edited files or Copilot
links are preserved and reported. Removal changes the actual discovery files in
the vault, so all local agents using those files are affected.
Preserved skills can remain discoverable until you remove them through their owner.

Copilot can migrate native skills into its shared folder and manage links. The
csvzall installer will not overwrite those links or recreate entries you removed
or disabled during ordinary refresh. If you choose that migration, maintain the
shared skill in Copilot, or explicitly resolve the reported links before using
csvzall's repair action. Same-name user skills are never replaced automatically.

## Validation status

See the [implementation and validation record](agent-integration-plan.md#implementation-validation)
for actual client results and remaining limitations. An automatic model choosing
the skill is distinct from the host discovering it and allowing execution.
