---
layout: default
title: Airport Layout
parent: User Manual
nav_order: 1
description: The operator layout for reading and steering Mission work.
---

Airport is the operator surface for the Mission daemon.

Its panes are projections over daemon-owned state:

- **Tower**: command, stage, task, and selection control
- **Runway**: live Agent session execution
- **Briefing Room**: artifacts and focused Mission documents

Airport may cache local surface preferences such as layout and selection. Domain state, workflow legality, Mission runtime data, and Entity behavior belong to the daemon.
