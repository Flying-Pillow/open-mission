---
issueId: 13
title: "Stop empty stage generation from recursively re-requesting implementation tasks"
type: "task"
branchRef: "mission/13-stop-empty-stage-generation-from-recursively-re-"
createdAt: "2026-04-11T16:23:45.765Z"
updatedAt: "2026-04-11T16:23:45.765Z"
url: "https://github.com/Flying-Pillow/mission/issues/13"
---

Issue: #13

## Summary

Completing `spec/02-plan` currently pushes the mission into the implementation stage, but if the implementation generation rule has no `templateSources` and produces no runtime tasks, the reducer keeps emitting `tasks.request-generation` for the same eligible stage.

That causes repeated empty `tasks.generated` events until event id reuse eventually triggers a validation failure.

## Problem

The reducer's generation request logic only checks whether the eligible stage currently has runtime tasks. It does not distinguish between:

1. a stage that still needs generation
2. a stage that has already been generated but yielded zero tasks
3. a stage whose generation rule cannot currently materialize runtime tasks

In replay and in normal workflow execution, that produces recursive empty generation attempts for implementation.

## Expected Outcome

Mission should avoid repeated empty generation for an eligible stage.

Possible acceptable behaviors include:

- treat an empty `tasks.generated` as a terminal generated state for that stage
- suppress generation requests when the stage generation rule cannot materialize tasks
- require the stage configuration to provide deterministic task definitions before requesting generation

## Constraints

- keep event ingestion deterministic
- do not rely on timestamp collisions to stop recursion
- preserve reducer/request-executor separation
- keep runtime and replay behavior coherent for omission cases

## Notes

This was discovered while replaying issue #11 in emulation mode after recording the broader implementation-task-generation omission separately.
