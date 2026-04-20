---
dependsOn: ["implementation/03-compose-docs-route-layout-and-mdsvex-page-rendering"]
agent: "copilot"
---

# Integrate Docs Discoverability And Daemon-Independent Access

Integrate the new docs surface into the shared Airport shell so users can discover and reach it without disturbing existing daemon-backed routes. This slice should add the first-class `/docs` sidebar affordance, active-route behavior, and the narrow daemon-gate exception that keeps docs reachable when the daemon is unavailable while leaving the rest of the Airport route protections intact.

