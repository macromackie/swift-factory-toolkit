---
name: delivery
message: Bound local resources and identify every artifact before reuse or distribution.
---

# Resource and artifact ownership

Commands must be safe to run from independent application repositories on one machine.

## Rules

- Reuse a local backend only when its app, environment, protocol and source build identity match the manifest.
- Give each started stack a receipt, an owning supervisor and a deadline. Signal only a process whose receipt token
  still appears in its command identity. A reused stack never grants teardown ownership.
- Lease a simulator UUID before changing its device-global settings. Attempt to restore every changed setting before
  releasing the lease, including failed tests. Record a failed restoration as failed evidence.
- Bind reusable test builds to source, manifest, application, runner and xctestrun hashes. Reject changed artifacts.
- Keep archive, export and upload separate. Export preserves the archive's version and build and cannot upload.
- Keep raw recordings and explicit edit intervals. Retained footage plays at real speed; preserve source hashes.
- Keep credentials in the invoking application's environment. Receipts contain identities and hashes, never environment
  dumps, command credentials or source contents. Treat build logs, screenshots and recordings as private evidence.

## Checks

`test/ownership.test.js` exercises independent stacks, reused ownership, stale identity, bounded readiness and changed
archives. It also checks that inherited credentials are absent from receipts.

Before distributing a new toolkit version, run a real application snapshot with fresh and reused build receipts,
inspect the screenshots and accessibility attachments, and check simulator settings after a deliberately failed run.
Run an authorized archive/export and inspect its app identity and receipt. Upload is a separately authorized operation;
an upload command's success does not establish App Review submission or customer release.
