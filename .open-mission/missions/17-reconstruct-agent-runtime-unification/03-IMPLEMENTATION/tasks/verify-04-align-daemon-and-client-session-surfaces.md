---
dependsOn: ["implementation/04-align-daemon-and-client-session-surfaces"]
agent: "copilot-cli"
---

# Verify Daemon And Client Session Surfaces

Verify that daemon and client session operations now route through one unified runtime path after this slice. Confirm the focused daemon and client tests cover configured runner loading, session launch, prompt, command, cancel, terminate, and reconnect semantics without preserving dual runtime registries. Record any remaining gaps in VERIFY.md.

Use the product artifacts in this mission folder as the canonical context boundary.