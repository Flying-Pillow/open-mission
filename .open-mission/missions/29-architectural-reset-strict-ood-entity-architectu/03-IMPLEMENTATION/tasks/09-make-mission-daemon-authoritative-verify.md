---
taskKind: "verification"
pairedTaskId: "implementation/09-make-mission-daemon-authoritative"
dependsOn: ["implementation/09-make-mission-daemon-authoritative"]
agent: "copilot-cli"
---

# Verify Mission Daemon Authority

Paired task: `implementation/09-make-mission-daemon-authoritative`.

Focused checks: Mission source methods use canonical schemas, resolve mission instances explicitly, dispose runtime resources, fail loudly for missing missions and invalid payloads, and return acknowledgements or source-local results rather than global projection snapshots.

Failure signals: `MissionRemote` remains the only daemon-callable behavior owner, Mission methods bypass canonical schemas, mission resolution silently falls back to route state, or command methods still require broad snapshot responses for correctness.

Ignore: Airport mirror still applying command-returned snapshots and route-local Mission request APIs. Those are later tasks.

Evidence: append focused test output and boundary notes to `03-IMPLEMENTATION/VERIFY.md`.
