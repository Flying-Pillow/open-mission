---
layout: default
title: Workflow Engine
parent: Architecture
nav_order: 5
description: How repository-owned workflow law drives Mission behavior.
---

A Mission workflow definition is repository-owned validated workflow law.

It describes stage order, task generation, gate rules, artifact expectations, and execution constraints. The Running Mission instance applies that law; it does not become a different class for each workflow.

Workflow variability belongs in the definition, not in alternate Mission subclasses or surface-specific control paths.

This keeps the Mission Entity stable while allowing repositories to define different delivery flows.
