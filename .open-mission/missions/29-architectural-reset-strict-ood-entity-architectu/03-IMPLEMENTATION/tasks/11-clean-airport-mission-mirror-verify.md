---
taskKind: "verification"
pairedTaskId: "implementation/11-clean-airport-mission-mirror"
dependsOn: ["implementation/11-clean-airport-mission-mirror"]
agent: "copilot-cli"
---

# Verify Airport Mission Mirror

Paired task: `implementation/11-clean-airport-mission-mirror`.

Focused checks: Airport components reach Mission behavior through Mission/child entity mirrors, Mission transports use generic entity query/command remotes, browser code imports canonical schemas only, and task/session/artifact methods route through the owning Mission mirror until those children become source entities.

Failure signals: components fetch Mission documents/actions/control directly, MissionCommandTransport still treats broad runtime snapshots as command reconciliation, browser-reachable code imports daemon/node Mission surfaces, or Task/AgentSession mirrors bypass Mission ownership.

Ignore: leftover server routes that are not active callers after mirror migration. Route removal is the final cleanup task.

Evidence: append focused web test output, static import scans, and caller scans to `03-IMPLEMENTATION/VERIFY.md`.
