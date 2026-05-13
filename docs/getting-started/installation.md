---
layout: default
title: Installation
parent: Getting Started
nav_order: 1
description: Install Mission and launch the Airport operator surface.
---

Mission ships as the @flying-pillow/open-mission CLI package.

~~~bash
npx @flying-pillow/open-mission
~~~

For repeated use:

~~~bash
npm install -g @flying-pillow/open-mission
mission
~~~

## Requirements

- Node 24
- pnpm for local development in this repository
- Git
- GitHub CLI access for the currently implemented tracking flows

On Linux, mission install can provision the Mission-managed GitHub CLI when it is missing and records the resolved binary path in Mission config.

## What Starts

The CLI opens Airport and connects it to the Mission daemon. The daemon owns repository state, Mission runtime state, Entity command dispatch, and agent adapter coordination.

After Airport opens, continue with [Repository Setup](repository-setup.md).
