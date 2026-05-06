---
layout: default
title: Repository And Dossier
parent: Architecture
nav_order: 2
description: How repository control state and Mission dossiers divide durable ownership.
---

The Repository is the local checked-out Git repository used as the base for Mission work.

Repository control state lives under .mission. The key document is .mission/settings.json, which stores operator-editable values such as Mission worktree root, instruction paths, skills paths, and default Agent adapter preferences.

A Mission dossier is the tracked history and control record for one Mission. It lives under .mission/missions/MISSION_ID/ on the Mission branch ref and includes runtime data, events, artifacts, task definitions, and control records.

Repository control state prepares the ground. Mission dossiers record bounded work.
