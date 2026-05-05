---
layout: default
title: Operator Command Model
parent: Reference
nav_order: 4
description: How operator commands map to Entity-owned behavior.
---

Operator commands should be Entity commands whenever they change or depend on domain state.

| Target | Example commands |
| --- | --- |
| Repository class | register, clone, list |
| Repository instance | setup, read, list issues, start Mission |
| Running Mission instance | read, advance, pause, resume |
| Mission task | assign, launch, verify, retry |
| Agent session | send message, interrupt, read log |

Airport renders command views. The daemon dispatches methods. Entity classes own behavior.

If a command needs provider-specific work, the Entity should call an adapter. The provider shape should not become the command contract.
