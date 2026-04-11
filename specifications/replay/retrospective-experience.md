---
layout: default
title: Retrospective Experience
parent: Plans
nav_order: 5
---

# Retrospective Experience

This document records process lessons observed while reconstructing Mission's own history as retrospective missions.

It is intentionally experience-focused rather than architecture-focused.

## Session: Issue 11 Repository Adoption Replay

### Observation

During the shared session for issue `#11`, the work temporarily drifted away from the main mission boundary.

The original mission, as stated by `BRIEF.md` and `PRD.md`, is repository adoption and mission dossier layout as one coherent product outcome.

During the session, a real architecture inconsistency around dossier paths was discovered and correctly treated as important. However, that local inconsistency became the dominant focus for long enough that the generated `SPEC.md` started to overrepresent the folder-location correction and underrepresent the broader repository-adoption objective.

### Assessment

This is not just an editing mistake. It is a core product lesson.

Mission exists partly because long-running execution sessions naturally accumulate local discoveries, and those discoveries can pull attention away from the original intake boundary unless the workflow deliberately recenters on the brief and PRD.

In this session, the following pattern appeared:

1. the real mission started with a broad intake goal
2. a concrete architecture mismatch was discovered during execution
3. the mismatch was important enough to justify code and spec changes
4. the active working set narrowed around that mismatch
5. downstream artifacts began reflecting the local working set more than the original mission boundary

That pattern is exactly the kind of drift Mission should help surface and correct.

### Evidence

- The brief for issue `#11` is about repository adoption, first-mission bootstrap, shared versus local usage, repo switching semantics, and the mission dossier model.
- The PRD preserves that broader scope.
- The initial SPEC draft leaned too heavily toward the mission-folder location and nested dossier-path correction.
- The session also triggered conversation compaction, which is another signal that the current working set had grown dense enough that the original intake focus was at risk of being displaced by recent local detail.

### Lessons

1. A replayed stage artifact must be rechecked against the intake anchor before the task is considered complete.
2. Important architectural discoveries made during a session should be incorporated into the mission artifacts, but they should not silently redefine the mission boundary.
3. Conversation compaction is a process signal, not just a tooling event. It often indicates that the active context has become dominated by local execution detail.
4. The brief and PRD should be treated as explicit recentering checkpoints whenever a stage artifact is drafted after substantial mid-session discoveries.
5. Retrospective replay should record not only the architecture decision, but also the process failure mode that made the drift visible.

### Working Rule

When a session uncovers an important sub-problem that consumes substantial attention, the next stage artifact must explicitly answer this question before it is accepted:

Does this artifact still represent the mission we started, or does it mostly represent the most recent thing we learned?

If the answer is the latter, the artifact should be revised to restore alignment with the intake anchor.

### Resulting Adjustment

For issue `#11`, the SPEC should explicitly preserve the broader repository-adoption scope from the brief and PRD, while still documenting the path-model correction as one necessary design decision inside that larger mission.

## Session: Spec Planning Stop Condition

### Observation

The next planned step after drafting `SPEC.md` was to execute the `spec/02-plan` task and create implementation task files under `03-IMPLEMENTATION/tasks`.

Before doing that, the runtime contract was checked instead of assuming that filesystem task files would automatically become Mission workflow tasks.

That check found a real gap in the current implementation.

### Assessment

At the moment, the workflow engine exposes a `taskGeneration[].tasks` configuration field, but the task generator only consumes `templateSources` when producing a `tasks.generated` event payload.

This means there is no verified engine path, in the current code, that turns manually planned implementation task definitions into runtime tasks for the implementation stage.

Mission status, Tower projections, and available actions are driven from `mission.json` runtime tasks, not by scanning `03-IMPLEMENTATION/tasks` from disk.

As a result, creating implementation task files on disk without a corresponding runtime-generation contract would produce a misleading repository state: files would exist, but Mission would not necessarily treat them as real workflow tasks.

### Evidence

- `WorkflowTaskGenerationRule` includes both `templateSources` and `tasks`.
- workflow settings normalization preserves the `tasks` array.
- the current generator implementation only renders `templateSources` and ignores `tasks`.
- stage status and Tower task projections are built from runtime tasks in `mission.json`, not from filesystem discovery of stage task files.
- the workflow checklist requires deterministic task generation from the workflow snapshot plus `stageId`.
- the core object model describes `TaskGenerationRule` as defining what task definitions should be instantiated.
- docs describe implementation as paired with verification mechanics, including `verify-` task generation behavior.
- no inspected spec, test, or code path explicitly says that a free-form agent session is allowed to invent implementation runtime tasks outside the deterministic workflow generation contract.

### Working Rule

If the next replay step depends on a runtime contract that cannot be verified in code, stop the replay at that boundary.

Do not simulate the missing behavior with hand-authored runtime mutations or by writing plausible files to disk.

### Resulting Adjustment

The replay should pause at `spec/02-plan` until one of these becomes true:

1. the existing codebase reveals the intended implementation-task ingestion contract, or
2. a new mission explicitly implements that missing contract in Mission itself.

Stopping here is preferable to inventing runtime behavior, because invented behavior would create hallucinated workflow history and contaminate the retrospective record.

### Current Conclusion

Based on the code and specifications inspected so far, this looks like a real product gap rather than an already implemented deterministic contract.

If the intended behavior was instead that an agent should read `SPEC.md`, create implementation task files manually, and somehow rely on that as the source of truth, that would still be an omission in the product design.

It would be nondeterministic, under-specified, and inconsistent with the current workflow model, which treats runtime tasks in `mission.json` as authoritative and requires deterministic task generation from the workflow snapshot.

So the safe conclusion is:

1. no verified deterministic implementation-task generation path has been found yet
2. no verified explicit manual-agent exception has been found yet
3. until one of those exists, replay must not continue past this boundary

## Session: Omission Issue First, Then Emulation

### Observation

After confirming the implementation-planning omission, the replay policy was adjusted.

Instead of treating the omission as a hard stop forever, the omission was recorded as a real GitHub issue first, and replay continued in explicit emulation mode because the current `SPEC.md` was specific enough to derive a bounded implementation inventory without guesswork.

During that continuation, a second omission was exposed: empty implementation-stage generation recursively re-requested itself until event-id reuse triggered a validation failure.

### Evidence

- issue `#12` records the missing deterministic implementation-task generation path
- issue `#13` records the recursive empty generation bug for implementation
- the implementation-stage `VERIFY.md` product was materialized by the current engine
- the implementation task inventory was then added explicitly in emulation mode with a matching `tasks.generated` runtime event

### Lesson

When replay uncovers a product omission, the correct order is:

1. record the omission as a real issue
2. decide whether the current mission artifacts are specific enough to continue without guessing
3. if yes, continue in explicit emulation mode and keep the emulated runtime state internally coherent
4. if no, stop and record why

### Resulting Adjustment

For issue `#11`, replay now continues past `spec/02-plan` in explicit emulation mode.

That continuation is justified because:

- the omission is recorded as a real issue
- the current SPEC gives a bounded implementation inventory
- the emulated task files and the runtime `tasks.generated` event now agree on the same implementation-stage ledger

## Session: Mission Boundary Collapse

### Observation

After restoring emulation-mode continuation, a second structural mistake was introduced.

The five identified retrospective missions were already established as peer missions to be replayed in order:

1. Repository Adoption And Mission Dossier Layout
2. Mission Semantic Model
3. Workflow Engine And Repository Workflow Settings
4. Agent Runtime Unification
5. Airport Control Plane

Despite that, the implementation ledger for mission `11` was rewritten as if those later replay missions could be represented as implementation tasks inside the first mission.

That caused mission `2`, Mission Semantic Model, to be collapsed into mission `1` instead of remaining a separate replayed mission.

### Assessment

This was a structural replay error, not just a task-labeling mistake.

It confused two different planning layers:

1. the retrospective mission sequence for reconstructing Mission's history
2. the implementation task ledger inside one replayed mission

Those layers are not interchangeable.

A replay mission may have implementation tasks, but those tasks must stay inside the scope of that one mission. A later replay mission must never be pulled backward and represented as a task inside an earlier mission.

### Evidence

- the canonical replay workflow already listed the five replay missions as separate missions
- mission `11` is the intake anchor only for Repository Adoption And Mission Dossier Layout
- the incorrect implementation ledger included a task named after Mission Semantic Model work inside mission `11`
- this contradicted the earlier decomposition and broke the intended replay sequence

### Lesson

When replay is decomposed into multiple retrospective missions, preserve the decomposition strictly.

Before creating or revising an implementation ledger, ask:

Is this work an implementation slice of the current mission, or is it actually the scope of a later replay mission?

If it belongs to a later replay mission, it must not be added to the current mission ledger.

### Resulting Adjustment

Mission `11` was corrected so its implementation ledger now covers only repository-adoption-layout work:

- repository adoption layout
- first-mission bootstrap
- repository modes and routing
- consumer, spec, and test alignment for mission `11`

Mission Semantic Model remains a separate future replay mission and must only be introduced after mission `11` is completed.

## Session: Replay Output Is A Working Reconstruction

### Observation

The replay process can easily be misread if replayed artifacts are treated as recovered truth instead of as the current output of the replay workflow.

That distinction matters most when replay exposes a real product omission that has already been recorded as a forward-looking GitHub issue.

### Assessment

Replay should learn from its own results, not blindly trust them.

If a replayed artifact drifts, collapses mission boundaries, or implies that omission-remediation now belongs inside the replay mission, that is a replay error to correct and record.

The omission issue already serves as the durable commitment to address the product gap later through a real mission. The replay should stay focused on reconstructing the historical mission coherently, not on absorbing that future implementation backlog into the current replay ledger.

### Lesson

When replay finds a real omission that is already tracked as a separate issue, the replay should do all of the following:

1. keep the replayed mission internally coherent for its chosen replay point
2. continue only if the next replay step can be derived without guesswork
3. avoid turning omission-remediation into implementation scope for the current replay mission
4. record any replay correction as process learning in this document

### Resulting Adjustment

The replay workflow reference now states more directly that replay outputs are corrigible working reconstructions and that omission issues belong to the real forward backlog unless a later curated replay mission explicitly covers them.

## Session: Primary And Secondary Specification Preservation

### Observation

After introducing the replay coverage map, mission `11` still relied on implied judgment for how cross-cutting source specifications should appear inside one replayed mission.

The mission was preserving the right architectural area, but it did not explicitly distinguish between:

1. source specifications primarily owned by mission `11`
2. source specifications that mission `11` may reference only for a narrow secondary preservation slice

That left room for later implementation work to widen the mission by updating any related spec that mentioned the same topic.

### Assessment

The coverage map alone is not enough if the replayed mission artifacts do not restate their own preservation boundary.

Each replay mission needs to say which source specifications it owns primarily, which cross-cutting sources it may preserve secondarily, and which normative areas remain owned by later replay missions.

Otherwise, broad implementation tasks like "update consumers, specs, and tests" can still invite cross-mission drift even when the high-level replay workflow is clear.

### Lesson

When a source specification legitimately spans multiple replay missions, the current replay mission should restate its local preservation boundary explicitly in `SPEC.md` and, when needed, in planning tasks.

### Resulting Adjustment

Mission `11` now states its primary and secondary specification-preservation boundary directly in `SPEC.md`, and its broad consumer/spec/test alignment task now explicitly forbids absorbing later replay-mission source material.

## Session: Do Not Promote Plausible Ideas Into Replay Scope

### Observation

A plausible handover behavior was discussed: the daemon could discover repository missions that belong to a registered repository even when the current machine does not yet have a local worktree for that mission.

That behavior may be desirable, but it was discussed as if it might already belong to the replayed repository-adoption mission.

### Assessment

That was a replay-discipline mistake.

For retrospective replay, a behavior belongs in scope only if the source specifications or other approved replay inputs actually support it.

It is not enough that the behavior is architecturally plausible, operationally useful, or consistent with a forward-looking product direction.

### Lesson

When a candidate behavior sounds reasonable but cannot be traced to the source specification corpus for the current replay mission, do not fold it into the replay.

Treat it instead as out of scope for the current replay unless supporting source evidence is found.

### Resulting Adjustment

Repository-adoption replay remains limited to the behaviors actually supported by its source specifications. Plausible handover or checkout-discovery ideas must not be added to the replay contract without source evidence.

## Session: Do Not Let Generic Implementation Momentum Override Replay Scope

### Observation

After explicitly recording the lesson that plausible product ideas must not be promoted into replay scope without source evidence, the next step still jumped directly into code changes.

That implementation work treated the most recent architecture discussion as if it had already become an approved replay requirement.

No replay-scoped source evidence was established first, and no separate issue or brief was created for forward product work.

### Assessment

This was a process failure.

The immediate cause was that generic implementation momentum overrode replay discipline. Once the user said "continue," the work defaulted back to the coding-agent habit of progressing the current implementation slice instead of re-anchoring on the replay boundary that had just been clarified.

More concretely, the failure combined three mistakes:

1. treating the latest design discussion as if it had become replay scope
2. failing to re-check that assumption against the preserved source specifications for mission `11`
3. moving directly to code changes instead of either stopping or explicitly spinning the idea out of replay scope

### Lesson

When replay scope has just been narrowed or corrected, the next step must begin with an explicit scope re-check before any implementation work starts.

If the candidate change is not traceable to the replay mission's approved source material, do not implement it under the replay mission.

Instead, either:

1. stop and keep the replay mission unchanged, or
2. move the idea into a separate forward-looking issue, brief, or later mission context

### Resulting Adjustment

Replay continuation should not automatically mean "continue coding." It should mean "continue within the currently verified replay boundary." Any change that cannot be justified from that boundary must be treated as out of scope until explicitly reclassified.