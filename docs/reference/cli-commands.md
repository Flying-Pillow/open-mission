---
layout: default
title: CLI Commands
parent: Reference
nav_order: 1
description: Public Mission command entry points.
---

The public CLI starts Mission and opens Airport.

~~~bash
npx @flying-pillow/mission
mission
~~~

The CLI is intentionally thin. It should launch or inspect the system, then let the daemon and Entity command surface own behavior.

Current operator responsibilities are:

- install or locate required local tools
- open the Airport surface
- connect to or start the daemon
- inspect daemon status
- stop the daemon when requested

Repository setup, Mission start, task launch, and runtime control are daemon-backed operations surfaced through Airport.
