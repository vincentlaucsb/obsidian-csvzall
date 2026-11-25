# Source code guidance

## Services and the resources they own

- When several callbacks share mutable state and manage one resource from creation through shutdown, give that resource a named owner. Keep its handle, timers, listeners, and cleanup together. Use this pattern when the resource has a lifetime of its own. A one-shot command that just returns output can stay a function.
- Keep coordination in the service and per-instance behavior on the resource. For example, `CsvzallProcessService` selects the helper and associates viewers with leaves. Each `CsvzallProcess` handles its own readiness, exit, and shutdown.
- Register a cancellable resource as soon as it exists, before awaiting readiness. Give callers one idempotent `stop()` operation that works during startup and while running. Closing a leaf, unloading the plugin, and a failed CSV open can then use the same cleanup path.

## Promises and resource lifetimes

- Keep a `new Promise` executor focused on the event its caller awaits. When a function also owns behavior that continues after resolution, split it where ownership changes. For example, viewer startup ends when the helper acknowledges readiness. The running session owns subsequent process exits.
- Release startup timers, listeners, and cancellation registrations on every path that settles startup. Have the running session's exit handler in place before announcing readiness. Pass the owning instance to the service when it exits so the service can detach it directly.
- Make required behavior explicit at the call site. An optional preflight callback should control only preflight work. Requesting Obsidian mode and verifying its acknowledgment belong to the viewer launch contract.

## Child-process output

- Parse streamed protocol records incrementally. Allow a record to span chunks or several records to arrive in one chunk. For viewer startup, validate the URL, host-mode acknowledgment, and any required viewer type together on the same record.
- Bound buffered output according to its purpose. Cap incomplete startup records, stop parsing the handshake once it succeeds, and keep draining long-lived streams while retaining only the diagnostic tail needed for error reporting.
- When changing a lifecycle boundary, exercise the event order the change affects. For example, a late ready message after cancellation must leave the session registry empty, and an exit just after readiness must reach the running session's handler.
