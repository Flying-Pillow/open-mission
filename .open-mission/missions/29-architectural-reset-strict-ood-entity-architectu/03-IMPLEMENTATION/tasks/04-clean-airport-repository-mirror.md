---
taskKind: "implementation"
pairedTaskId: "implementation/04-clean-airport-repository-mirror-verify"
dependsOn: ["implementation/03-replace-daemon-entity-dispatch-verify"]
agent: "copilot-cli"
---

# Clean Airport Repository Mirror

Objective: make Airport web reach Repository behavior through the Repository mirror and generic remotes.

Context: read SPEC Airport client contract, `Repository.svelte.ts`, generic remote dispatch files, Repository route remotes, and components that call Repository actions.

Allowed files: Airport Repository mirror, generic entity remote gateway helpers, direct Repository route/component callers, and focused web tests.

Forbidden files: daemon dispatch redesign, package export cleanup, SSE projection ownership, and workflow-engine structured runtime records.

Expected change: browser Repository methods import schemas from `@flying-pillow/mission-core/schemas`, call generic query/command remotes, parse source results, and expose component-facing methods. Components must not compose Repository remote payloads manually.

Compatibility policy: no new route-local Repository remote path; existing paths may only be removed or reduced while active callers move to the mirror.

Validation gate: focused remote dispatch and Repository mirror tests; run only relevant web checks.
