---
dependsOn: ["implementation/03-align-daemon-owned-workflow-settings-and-snapshot-timing"]
agent: "copilot-cli"
---

# Verify Daemon-Owned Workflow Settings And Snapshot Timing

Verify that repository workflow settings remain daemon-owned and that mission workflow snapshots capture repository policy only at the `draft` to `ready` boundary. Confirm the relevant settings-store, patch, validation, revision, and snapshot-timing tests cover initialization, conflict handling, and isolation after mission start. Record any remaining gaps in VERIFY.md.

Use the product artifacts in this mission folder as the canonical context boundary.
