---
layout: default
title: Agent Session Logs As Daemon Audit Material
parent: Architecture Decisions
nav_order: 11
status: accepted
date: 2026-05-04
decision_area: agent-session-log
owners:
  - maintainers
supersedes: []
superseded_by: []
---

Raw Agent session logs are daemon-owned audit material, not Mission artifacts by default. They are retained with the Mission dossier/state store so Mission can inspect delivered interaction, recover context, and preserve evidence of what was sent to and produced by an Agent runtime.

Mission control should not show every raw session transcript as a Mission artifact. This keeps the operator outline focused on curated Mission work rather than terminal exhaust.

When log-derived material becomes useful to the Mission, the daemon or operator promotes a curated derivative into a separate Agent-session artifact. Examples include a transcript summary, extracted test output, patch summary, or generated implementation note. The promoted artifact may reference or quote the raw Agent session log, but it is not the raw log itself.

This keeps raw runtime interaction durable and inspectable while preserving a small, intentional Mission artifact model.
