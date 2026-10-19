---
name: obsidian-warning-remediation
description: Remediate obsidian-csvzall Community scorecard warnings and deprecated-method notices under Other, plugin submission feedback, or release validation failures using the repository's documented review workflow. Use when asked to investigate or fix that feedback.
---

# Remediate Obsidian warnings

Read [the repository guide](../../../AGENTS.md) and
[the warning remediation workflow](../../../docs/obsidian-warning-remediation.md)
before starting. The remediation document is the source of truth for evidence
collection, triage, implementation constraints, versioning, and validation;
follow its current contents instead of relying on this entry point alone.
Run commands from the repository root.

1. Synchronize the checkout as required by `AGENTS.md`, preserving existing work.
   Use feedback supplied by the user when available. Run
   `npm run review:obsidian -- --warnings path/to/feedback.txt` for a supplied
   feedback file, or `npm run review:obsidian` to collect the public scorecard.
   Read the fresh completion marker, all scorecard findings (including Other
   and Disclosures), and downloaded official guidance. Treat deprecated-method
   notices under Other as actionable even when their severity is informational.
   Record unavailable evidence; a failed retrieval is not a clean review.
2. Compare the affected release and source commit with the checkout. Record each
   finding and its disposition in a dated `docs/obsidian-review-YYYY-MM-DD.md`
   report, following the document's triage requirements. Fix actionable defects
   in their owning modules. Preserve required desktop capabilities and the
   desktop/mobile separation described in the guide. Replace deprecated methods
   with supported alternatives and verify their introduction versions against
   each affected distribution's minimum-version metadata; record any justified
   deferral rather than silently skipping an Other notice.
   When maintaining existing rules, you may shorten or deduplicate them and
   group related rules under a more general rule. Preserve their substantive
   requirements, scope, exceptions, and verification obligations; retain
   specific examples where they prevent ambiguity. Record significant rule
   consolidations in the review report.
3. Complete the document's validation commands and relevant demo-vault checks.
   Record actual results and unavailable checks in the report. Apply its version
   metadata rules when fixing validation failures. Review the final diff,
   including generated files and line-ending normalization.
4. Return a concise account of fixes, justified remaining warnings, validation
   results, unresolved evidence, and a link to the report. Leave changes
   reviewable. Tagging, publishing, and contacting reviewers require separate
   user authorization as specified in the remediation document. Claim public
   warnings cleared only after verifying the hosted scorecard's release and
   source commit.
