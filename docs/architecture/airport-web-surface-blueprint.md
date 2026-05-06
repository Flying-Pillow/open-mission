---
layout: default
title: Airport Web Surface Blueprint
parent: Architecture
nav_order: 11
description: Direction for the web Airport surface without changing daemon ownership.
---

The web Airport surface should follow the daemon-owned Mission and Airport application boundaries.

It may provide richer navigation, panels, editing affordances, and live updates. It must still consume daemon-published data and send commands through Entity contracts.

The web surface should not own:

- Mission lifecycle rules
- Repository setup behavior
- Agent adapter semantics
- persisted Mission runtime data
- compatibility parsing for stale daemon shapes

Better UI is welcome. New domain authority is not.
