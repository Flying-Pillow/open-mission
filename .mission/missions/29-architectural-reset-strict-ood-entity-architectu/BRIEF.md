---
issueId: 29
title: "Architectural Reset: Strict OOD Entity Architecture For Airport And Daemon"
type: "task"
branchRef: "mission/29-architectural-reset-strict-ood-entity-architectu"
createdAt: "2026-04-22T14:54:07.971Z"
updatedAt: "2026-04-22T14:54:07.971Z"
url: "https://github.com/Flying-Pillow/mission/issues/29"
---

Issue: #29

# Architectural Reset: Strict OOD Entity Architecture For Airport And Daemon

## Overview
This issue outlines a full architecture reset to establish a strict Object-Oriented Design (OOD) entity architecture. The goal is to centralize authority within the Daemon/Core and treat the SvelteKit web layer strictly as a transport and presentation medium.

## Core Principles
- **Full Architecture Reset:** Clean slate approach to entity management and data flow.
- **Authoritative Backend:** The Daemon/Core owns all authoritative backend entities.
- **Transport-Only Web Layer:** SvelteKit web layer is responsible only for transport and UI; it holds no business logic or authoritative state.
- **Entity Mapping:** Client-side entities must map directly to Daemon/Core entities.
- **Shared Contracts:** All shared contracts must be entity-shaped, reflecting the core OOD structures.
- **No Legacy Support:** No backward compatibility, no fallbacks, no aliases, and no accommodation for historic configurations.
- **Centralized Logic:** No scattered helpers or route-local business logic.
- **Contract Definition:** `mission.json` is explicitly NOT the client contract; it is a storage format, not the interface definition.

## Mandatory First-Class Entities
The following entities must be implemented as first-class objects:
- **Repository**
- **Mission**
- **Stage**
- **Task**
- **Artifact**
- **AgentSession**

## Acceptance Criteria
1. All mandatory entities are implemented in the Daemon/Core with clear interfaces.
2. The SvelteKit frontend uses these entity definitions for all data interactions.
3. System functions without any reliance on legacy configuration or "helper" hacks.
4. Business logic is strictly contained within the Daemon/Core entity methods or services.

## Verification Requirements
- API responses must match the new OOD entity shapes.
- Frontend state management must be driven by these entity definitions.
- End-to-end tests must verify the full lifecycle of a Mission from creation to Artifact generation using only the new architecture.

## Definition of Done
- Codebase is free of old entity patterns and legacy route logic.
- Documentation reflects the new strict OOD architecture.
- All mandatory entities are fully functional and integrated.
