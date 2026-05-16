---
layout: default
title: Impeccable Live
parent: User Manual
nav_order: 4
description: How to use Impeccable when previewing a webapp in your Repository or Mission.
---

Use Impeccable when you want help improving a live webapp preview.

If you create a webapp in your Repository or in a Mission worktree, and that webapp has a preview or dev server, ask the agent to enable Impeccable for that preview.

The important operator rule is simple: use Impeccable through the agent chat while previewing your app. Open Mission handles the supporting service details.

## Typical Use

Typical examples:

- "Enable Impeccable for this landing page preview."
- "I want to use Impeccable on this Mission webapp."
- "Please enable Impeccable for this repo's frontend preview."
- "I have a web server running for this app. Use Impeccable on it."

The agent should then help make the preview use Impeccable for the correct owner:

- the Repository, if the app belongs to the Repository root
- the Mission, if the app belongs to a Mission worktree

## What You Need

To use Impeccable on a previewed webapp, you need:

- a webapp in your Repository or Mission worktree
- a preview, dev server, or hosted app route that the app can be viewed through
- the agent chat, so the agent can help enable Impeccable for that preview

If your app does not have a preview yet, ask the agent to help create one first.

## How To Use It

1. Create or open the webapp you want to preview.
2. Make sure the app can be previewed through a web server or preview route.
3. In agent chat, ask to enable Impeccable for that preview.
4. Tell the agent whether the app belongs to the Repository or to the active Mission if that is not already obvious.
5. Preview the app and use Impeccable through that preview.

Good prompts are short:

- "Enable Impeccable for this repo preview."
- "Enable Impeccable for this Mission landing page."
- "This app runs on a local preview. Please wire it up to Impeccable."

## Repository Or Mission?

Use the Repository when the app belongs to the Repository root.

Use the Mission when the app belongs to the Mission worktree.

If you are not sure, ask the agent which owner should be used for the preview.

## What The Agent Helps With

When you ask to enable Impeccable, the agent can help with tasks such as:

- finding the correct app preview entry point
- checking whether the app already has a usable preview server
- wiring the preview to use Impeccable
- using the correct Repository or Mission owner
- helping you continue design work once the preview is live

## What Open Mission Handles

Open Mission handles:

- Impeccable service startup
- daemon lifecycle details
- port and process ownership coordination
- path-based setup
- keeping Impeccable inside the Open Mission product model

If you are previewing your webapp and want Impeccable, ask the agent to enable it for that repo or Mission preview.

That is the user-facing model.
