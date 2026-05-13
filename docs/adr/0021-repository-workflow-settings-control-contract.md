---
layout: default
title: Repository Workflow Settings Control Contract
parent: Architecture Decisions
nav_order: 21
status: accepted
date: 2026-05-06
decision_area: repository-workflow-settings
owners:
  - maintainers
supersedes: []
superseded_by: []
---

Repository workflow settings are repository-level defaults that seed future Mission workflow snapshots. They are stored in `.mission/settings.json` as the `workflow` section of the Repository settings document.

The daemon owns repository workflow settings behavior. It loads effective settings, initializes missing settings during Repository initialization, validates updates, persists accepted changes atomically, emits control-plane events, and exposes the protocol methods used by every surface. Surfaces collect operator input and render daemon responses; they do not write `.mission/settings.json`, define policy validation, perform independent merge semantics, or silently coerce invalid values.

Workflow settings updates use RFC 6902 JSON Patch with an expected revision token. The daemon must validate patch shape, validate an allowed path set, apply the patch to a normalized copy, run semantic validation, persist with an atomic replace, emit an update event, and return the updated settings with a new revision token. Deep partial object merges are not accepted because arrays and dictionaries need explicit delete and reorder semantics.

The revision token must reflect persisted file state, such as the current `.mission/settings.json` content hash or an equally strict fingerprint. An in-memory counter alone is not enough. Before applying an update, the daemon recomputes or revalidates the token against disk state. A mismatch returns a settings conflict and requires the surface to fetch fresh settings before retrying.

Validation is daemon-owned and deterministic. At minimum, execution limits must be positive integers, stage order must be non-empty and unique, stage records must match their ids, gates and task generation rules must reference known stages, and task launch policy values must have valid boolean shapes. Adapter metadata may be persisted as opaque JSON metadata, but unknown metadata keys remain adapter-owned unless a future ADR promotes a key into cross-adapter Mission vocabulary.

Repository workflow settings affect Mission snapshots only at the Mission lifecycle boundary. A draft Mission does not yet own an isolated workflow configuration snapshot, so repository setting updates can still affect it. At the transition from draft to ready, the daemon snapshots repository workflow settings into Mission runtime data. Ready, running, paused, completed, and delivered Missions are isolated from later repository setting changes unless a future explicit migration command is decided.

Control mode is the operator mode where Repository initialization and repository policy operations are available. CLI, Open Mission web, Open Mission native, and future surfaces must use the same daemon command and method contract for repository workflow settings. Editable workflow settings UI is a surface affordance; workflow settings authority remains in the daemon and Repository behavior.

This decision complements Repository initialization before Mission start. Repository initialization creates or updates repository control state; repository workflow settings define the daemon-owned contract for editing the workflow defaults inside that control state.
