---
layout: default
title: Retire Projection As Canonical Vocabulary
parent: Architecture Decisions
nav_order: 2
status: accepted
date: 2026-05-04
decision_area: language
owners:
  - maintainers
supersedes: []
superseded_by: []
---

Mission previously used projection-oriented communication where broad derived mission data was sent to clients after changes. Mission 29 moves communication toward canonical Entity data plus fine-grained Entity events, with System snapshots reserved for bootstrapping and reconnecting clients.

The term "projection" is no longer canonical future vocabulary because it hides several different concepts: system bootstrap state, entity change events, Open Mission pane rendering data, Mission control navigation state, and workflow-derived runtime state. New code should use precise names such as System snapshot, Entity event, Open Mission app pane view, Mission control view, and Derived workflow state; existing `Projection` names are transitional and should be renamed or removed as their modules are refactored.
