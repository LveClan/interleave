---
name: deep-review
description: Audit Interleave across components and harden it with independent review. Use for a requested whole-app quality pass or broad hardening, not an ordinary diff review.
---

# Review And Harden Interleave

Audit the requested application scope for behavior, architecture, design, and meaningful test
coverage. For a hardening request, fix demonstrated defects and commit reviewed changes per
component. If the user requests findings only, perform a read-only audit and report findings;
that request does not authorize fixes or commits.
For that mode, use the coverage and review criteria below, skip the fix/commit loop, and complete
the audit by reporting findings and verification limits. Unfixed findings do not prevent delivery
of a requested read-only review.

Follow the root `AGENTS.md` for user precedence, working-tree preservation, English commits,
environment discovery, and verification scope. Use actual collaboration tools and the current
checkout; no specific orchestration product, model, signing provider, or resume API is required.

## Coverage And Ownership

Build a coverage list from the current app and requested scope. Useful boundaries include:

- Domain types, schema/migrations, repositories/transactions, schedulers, editor, and importers.
- Electron lifecycle, security, IPC, asset vault, local jobs, and extension capture.
- Shell/navigation, inbox, reader/extraction/lineage, queues, cards, and review.
- Concepts/tags/search, maintenance, trash/undo, analytics, settings, and backups.
- Shared design/accessibility, integration, persistence, and packaging where applicable.

Use as many components as needed for coverage, without a fixed phase count. Read each area's
scoped instructions and relevant specs, plans, solutions, and design references when auditing it.
Check historical requirements against current code and later documented decisions.

Delegate independent audits when collaboration is available. Give each agent explicit scope,
file ownership, and references. Agents share a workspace unless isolated; preserve others' edits.
Serialize overlapping fixes, shared builds, and Electron checks. The coordinator owns commits.
The reviewer of a fix must not be its author; reuse that reviewer for follow-up rounds.

If independent review is unavailable, continue useful local auditing, fixes within authorized
scope, and verification, but label self-review accurately. Leave independent review outstanding
and do not make completion commits or claim the hardening gate passed.

## Review Criteria

- Verify real data and command paths through `window.appApi`, including failures and edge cases.
- Preserve project invariants: trusted local persistence, transactions and `operation_log`,
  source lineage, stable document anchors, and separate FSRS and attention scheduling.
- For UI, inspect the relevant design references, tokens, light/dark states, keyboard behavior,
  and loading/empty/error states. Evaluate observed behavior rather than personal taste.
- Identify missing tests by the user behavior or data risk they fail to prove. Do not add tests
  merely to duplicate an implementation detail.

Each finding needs a file/location, evidence, impact, severity, and actionable correction. Fix
demonstrated issues within scope, including minor defects. Track out-of-scope improvements
separately. Large refactors may be deferred with a reason, but an unresolved acceptance or
invariant violation still prevents that component from passing.

## Audit, Fix, And Re-review

For each component, audit the actual code and evidence, fix findings, and independently review
the changed behavior and affected dependencies. After six review rounds, reassess recurring
findings and change the repair approach as needed. Continue when a concrete feasible correction
remains; record a real blocker when progress is no longer possible. Every final fix requires
independent re-review; an unreviewed result cannot pass.

Record the component, reviewed code state, verdict, check results, findings, and deferred items.
A pass requires the requested behavior and invariants to hold, required checks to pass, and no
unresolved blocking findings. A missing reviewer verdict is an incomplete review, not a pass.

Commit only reviewed, verified component changes using an English subject such as
`harden(reader): preserve source navigation after editing`. Include only task-owned changes on
the current task branch, preserve configured Git identity/signing, and omit invented model
coauthor trailers. A clean audit without changes requires no commit. Do not push without
authorization. If a commit fails, report it as incomplete and preserve the work.

When progress, required review, or verification is blocked, preserve the component's work as
incomplete; do not make its completion commit. Continue independent components only where the
unfinished changes cannot contaminate their code, tests, or commits, using an isolated worktree
when appropriate. Shared failures or dependencies can block further implementation; report them
and continue independent read-only auditing where useful.

## Verification And Resume

Establish baseline results as needed to distinguish regressions from existing failures. A known
flake needs reproducible evidence and bounded investigation, not endless reruns until green.
Repair it when within scope; otherwise report it, including its effect on the completion gate.

Use focused checks during fixes and follow the root Definition of Done before completion commits.
Record which code state the results cover. Reviewers inspect evidence independently and run
checks to resolve uncertainty; unchanged full suites need not be rerun by each role. Final
integration verification covers cross-component effects, relevant Electron E2E, restart
persistence, and packaging when packaging is in scope. Refresh results invalidated by later edits.

An unavailable platform, service, credential, or tool is a concrete verification blocker. Use an
equivalent supported local check if it proves the same requirement; otherwise report what is
unverified. Do not assume macOS signing, upstream release access, or hosted backup infrastructure.

Resume from the coverage list, Git state, and recorded evidence, checking for intervening changes.
Report audited components, fixes and commits, verification, outstanding reviews/checks, and all
residual or deferred findings. Claim completion only for components that actually passed.
