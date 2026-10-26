---
name: delivery
message: Bound owned resources and preserve another application's processes and simulator state.
paths: ["src/**/*.ts", "test/**/*.ts", "test/**/*.js", "helpers/**/*"]
---

# Resource lifecycle

Commands must be safe to run from independent application repositories on one machine.

## Rules

Reuse a backend only when its app, environment, protocol and source identity match the validated manifest.
Give each started stack a typed receipt, owning supervisor and deadline. Signal only a process whose receipt token
still appears in its command identity. A reused stack grants no teardown ownership.

Lease a simulator UUID before changing device-global settings. Attempt to restore every changed setting before
releasing the lease, including after a failure or interruption. Record a failed restoration as failed evidence.
Keep resource acquisition, ownership transfer and cleanup visible in the same lifecycle.

Keep application commands, credentials, scenarios, endpoints and release decisions in the consuming repository.
The CLI validates input and selects an operation; execution modules own effects and cleanup. Keep credentials in
the invoking process environment and omit them from receipts and diagnostic command rendering.

## Checks

Run `test/ownership.test.ts` through `pnpm check` for independent stacks, reuse, stale identity, bounded readiness and redaction.
Before a toolkit release, run a real application capture and an interrupted capture. Confirm exact owned process
cleanup and simulator restoration, and preserve any preexisting service. A successful Linux check does not establish
Apple simulator behavior.
