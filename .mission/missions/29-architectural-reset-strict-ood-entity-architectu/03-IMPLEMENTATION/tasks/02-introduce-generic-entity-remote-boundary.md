---
taskKind: "implementation"
pairedTaskId: "implementation/02-introduce-generic-entity-remote-boundary-verify"
dependsOn: ["implementation/01-define-authoritative-backend-entity-vocabulary-verify"]
agent: "copilot-cli"
---

# Introduce Generic Entity Remote Boundary

Introduce the reference-style generic entity remote boundary for queries, commands, and forms so Airport transport converges on stable entity-method dispatch. This slice should add `apps/airport/web/src/routes/api/entities/remote/query.remote.ts`, `command.remote.ts`, and `form.remote.ts` if needed, keep `AirportWebGateway.server.ts` thin, and collapse or reduce `airport.remote.ts`, repository issue remotes, and mission remotes to transitional glue around the generic dispatch surface.

Use the product artifacts in this mission folder as the canonical context boundary.
