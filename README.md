
# 🌍 Mission

**The orchestration engine for AI-driven software development.**

Mission is a local state machine and governance layer that sits between your issue tracker and your AI coding agents. It brings predictability, architectural strictness, and deterministic verification to AI-assisted development.

If you have ever spent hours untangling AI-generated "spaghetti code" or fighting context rot in a long chat session, Mission provides the structural guardrails to make AI development safe, scalable, and maintainable.

---

## The Problem

AI coding agents (like GitHub Copilot CLI, Claude Code, or Cursor) excel at generating code quickly. However, they lack architectural awareness. Left unmanaged, AI agents tend to:
*   Bypass established design patterns and object-oriented boundaries.
*   Modify out-of-scope files, creating unintended blast radiuses.
*   Lose context over long sessions, leading to hallucinated logic.
*   Require constant human micromanagement to stay on task.

The result is a fast-growing accumulation of silent technical debt.

## The Solution

Mission acts as Air Traffic Control for your repository. It does not replace your AI agents; it manages them.

By shifting the workflow from **prompt-driven** to **spec-driven**, Mission locks the AI into a strict execution loop. It pulls your issues, compiles them into explicit Implementation Blueprints, and forces the AI to execute one bounded task at a time. Most importantly, it intercepts the AI's actions to ensure they comply with your repository's unique architectural rules before any code is permanently saved.

---

## Core Capabilities

*   📜 **Architectural Governance** 
    Define your repository's specific engineering standards in a single `.agents/constitution.md` file. Mission injects these laws into every session, ensuring the AI respects your tech stack, formatting, and structural boundaries.
*   📦 **Isolated Git Worktrees** 
    Never let an AI hallucination corrupt your local workspace again. Mission automatically provisions a dedicated, isolated Git worktree for every active mission. The AI is physically jailed to this directory, leaving your primary branch pristine.
*   🗺️ **Spec-Driven Execution** 
    Stop chatting and start building. Mission translates your GitHub or Jira issues into strict `SPEC.md` blueprints and bounded task ledgers. The AI is mathematically constrained to the approved file-impact matrix.
*   🛑 **Deterministic CI Gating** 
    Mission disables AI self-praise. An agent cannot simply claim a task is "done." Mission gates all progress behind your actual CI pipeline (linters, unit tests). If the AI's code fails, Mission blocks the transition and forces the agent to fix it.
*   🤖 **Agent-Agnostic** 
    Avoid vendor lock-in. Mission manages the state machine, allowing you to seamlessly swap the underlying compute engine (Copilot, Claude, Aider, etc.) as the AI landscape evolves.
*   🎛️ **The Interactive Cockpit** 
    Steer missions through a powerful Terminal User Interface (TUI). Because Mission runs as a persistent background daemon, you can safely detach from the cockpit, close your terminal, and reconnect later without interrupting the AI's flight.

---

## Installation & Quick Start

Mission is designed to be lightweight and frictionless to install in any existing repository.

**1. Install globally:**
```bash
npm install -g @flying-pillow/mission
```

**2. Initialize your repository:**
This command safely scaffolds the `.mission/` state directory and the default Mission settings file.
```bash
mission init
```

**3. Launch the Cockpit:**
Open the interactive terminal surface. Mission will automatically start the background daemon, allowing you to bootstrap a new mission from your issue tracker directly inside the UI.
```bash
mission
```

---

## Command Surface

Run `mission help` for the complete command reference. Because Mission relies on a persistent sidecar daemon, state transitions, agent execution, and delivery are now handled via Cockpit-driven RPC actions rather than standalone top-level commands.

Currently implemented CLI entry points:

*   `mission [--hmr] [--banner] [--no-banner]` — Launches the interactive cockpit (auto-starts the daemon if not running). Starting from a mission worktree auto-selects that mission; starting from the control checkout opens Mission control mode.
*   `mission daemon:stop [--json]` — Gracefully terminates the background orchestration daemon.

---

## How It Changes the Developer Experience (DX)

Mission restores the traditional balance of software engineering: **The Human acts as the Principal Architect, and the AI acts as the Developer.**

You no longer have to review every line of code as it is being typed. You define the rules, you approve the blueprint, and you review the final, CI-verified Pull Request. Mission handles the chaotic execution in the middle.

## License

...