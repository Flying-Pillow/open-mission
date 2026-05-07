---
layout: default
title: Recovery And Reconciliation
parent: Architecture
nav_order: 12
description: How Mission handles accepted state and failed checkpoints.
---

Mission distinguishes accepted daemon state from later persistence failures.

After a State store transaction is accepted, the daemon keeps the in-memory state live. If a later Mission dossier checkpoint fails, the Mission is marked for recovery attention instead of silently rolling back runtime state or external worktree changes.

Recovery should be visible, explicit, and recorded. Hidden reconciliation creates worse failures later.
