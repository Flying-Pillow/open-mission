---
layout: default
title: Airport Terminal Surface
parent: Architecture
nav_order: 8
description: The terminal-backed Airport surface and its daemon relationship.
---

The terminal surface is an Airport client.

It opens the operator layout, displays daemon state, and routes commands to daemon-owned Entities. It may host terminal-backed runtime views, but raw terminal input is not the same thing as a structured Agent session message.

Keep the distinction sharp:

- Agent session messages are structured Mission system messages.
- Terminal input is raw input sent to a terminal-backed CLI runtime.
