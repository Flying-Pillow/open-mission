---
layout: default
title: Package Map
parent: Architecture
nav_order: 13
description: Where the main Mission responsibilities live in the monorepo.
---

| Area | Responsibility |
| --- | --- |
| packages/core | domain contracts, Mission law, runtime contracts, Entity model |
| apps/web | SvelteKit Open Mission host and web backend facade |
| apps/native | Tauri Open Mission native host |
| packages/open-mission | published Mission CLI and package boundary |
| packages/tsconfig | shared TypeScript policy |
| docs/adr | architectural decisions |
| .agents | agent instructions and skills |

No workspace should absorb another workspace's responsibility for convenience.
