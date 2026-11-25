---
name: review-code-changes
description: Review a pull request, branch, or local diff for actionable bugs and regressions. Use for pre-merge reviews, bug-fix verification, and re-review after changes, including correctness, data loss, responsiveness, and shipped behavior.
---

# Review code changes

Start with the action a user or caller takes and the result they rely on. Identify the requested behavior change, comparison base, and candidate revision. Include pending local edits when they are the review target. Read the applicable repository instructions and follow the diff from its public entry point through the code that observes, saves, or ships the result. On re-review, check earlier findings against the current revision.

## Choose probes that can expose a bug

Pick the questions implicated by the diff. For each suspected regression, try to disprove it by following the real caller, an existing guard, or a focused test.

- **Identity and fidelity.** After sorting, filtering, renaming, or reopening, what identifies the original object? Edit a value that changes its own position, save, then reopen. Check the intended record and its neighbors. When representation matters, include one discriminating input such as a large integer ID, a wider record, or an older configuration with an unfamiliar field.
- **Completion and concurrency.** Find the last fallible operation before the code acknowledges success, clears dirty state, deletes a source, or publishes a new location. Pause it. Make a newer edit, replace the view, or let a second writer finish. Resume it with success and with an error. Inspect what survives and what a retry does. Treat a missing optional file, an unreadable file, and an incompletely synced folder according to their distinct meanings.
- **Responsiveness.** Trace the path from the initiating action to the first usable result. Which reads, scans, timers, formatting, and redraws must finish first? Which work repeats with file size, vault size, or event frequency? Check initial load and repeated input separately. For an unchanged update, count the expensive observable operation and verify a genuine change still updates the UI. For a speed claim, compare the same fixture and shipped configuration, state the timing endpoints, alternate runs, and report variability or paired results.
- **Boundaries and distributions.** Trace an input across its actual callers, protocol, build profile, and packaged consumer as applicable. Check an older caller or saved format when the change crosses that boundary. For generated code or binaries, find the owning source, verify the pins and build inputs, and exercise a capability of the packaged result that could have disappeared. Choose the platform or configuration that distinguishes the failure.
- **Failure isolation.** Follow one failed item through a batch, one failed write through cleanup, or one background notification back into its own handler. Check whether unrelated work progresses, previously valid output survives, and a legitimate later event still runs.

Prefer a small behavioral regression test that fails against the faulty implementation and passes with the fix. Control the clock or operation order where timing matters. Assert effects a user or caller depends on, such as the saved bytes, query count, or first visible data. An exact internal call sequence needs a demonstrated cost or correctness consequence.

## Report findings

Lead with actionable findings in impact order. For each, give the changed file and line, reachable trigger, observed or code-traced consequence, and the smallest fix or test that addresses it. Distinguish experiments you ran from PR-author reports. Put unresolved assumptions in questions. If the suspected failure is already guarded, drop it. If no actionable findings survive, say so and name any material verification gap. Keep publication and code changes within the user's requested scope.

For worked examples, measured counterexamples, and the PR-by-PR evidence behind these probes, see the [csvzall review audit](references/csvzall-pr-audit.md).
