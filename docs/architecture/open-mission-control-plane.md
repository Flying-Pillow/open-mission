---
layout: default
title: Open Mission Control Plane
parent: Architecture
nav_order: 7
description: How Open Mission reads and steers daemon-owned state.
---

Open Mission is the operator-facing control surface.

It reads daemon-published data, renders available Entity commands, and sends operator intent back to the daemon. Local preferences can shape layout and selection, but they cannot become workflow law or Mission truth.

The useful rule: Open Mission may present and request; the daemon decides and records.
