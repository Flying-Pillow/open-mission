🚧 Open Mission is currently in Public Alpha (Developer Preview).
We (a 2-person team) are using this daily to build our own software, but the API and state machine are still evolving. You might encounter bugs. If you want to help us build the ultimate AI orchestration engine, drop a comment, open an issue, or try it out in a safe repository!

# Open Mission

**The orchestration engine for AI-driven software development. Cool!!!**

Open Mission is a local state machine, native host, and governance layer that sits between your issue tracker and your AI coding agents. It brings predictability, architectural strictness, and deterministic verification to AI-assisted development.

If you have ever spent hours untangling AI-generated "spaghetti code," fighting context rot in a long chat session, or fixing an active branch that an AI just trashed, Open Mission provides the structural guardrails to make AI development safer, scalable, and recoverable.

---

## The AI Coding Landscape: Why Open Mission?

The AI coding space has evolved rapidly, but existing tools suffer from severe architectural limitations. Here is how Open Mission compares to the current ecosystem:

| Feature / System | SpecKit | BMAD | GSD | Open Mission |
| :--- | :--- | :--- | :--- | :--- |
| **Primary Paradigm** | Spec formatting | Agile team simulation | CLI prompt orchestrator | **State Machine / Daemon** |
| **Context Management** | None | Agent memory (rots) | Fresh context per task | **Stateless Sessions + `mission.json`** |
| **Execution Safety** | None | None | Modifies active branch | **Isolated Git Worktrees** |
| **State Resilience** | None | None | CLI script (brittle if crashed) | **Reducer-based (Crash-proof)** |
| **User Interface** | CLI | CLI / Chat | Scrolling Terminal Text | **Interactive Open Mission app** |
| **Human-in-the-Loop** | Upfront only | Chat-based | Yes | **Native (Pause, Stop, Manual Tasks)** |

* **SpecKit** helps you write a prompt, but abandons you during execution.
* **BMAD** forces AI to roleplay as PMs and Architects, leading to massive overhead and hallucinated agreements in giant context windows.
* **GSD (Get Shit Done)** proved that developers want spec-driven, vertically-sliced tasks in fresh context windows. But because it relies on brittle CLI scripts executing directly on your active branch, it lacks safety and state recovery.
* **Open Mission** takes the best theoretical concepts of spec-driven execution and implements them with **architectural strictness and enterprise-grade resilience**.

## The Solution: Governed Agent Execution For Your Repo

Open Mission does not replace your AI agents (Copilot, Claude, Cursor, Aider); it manages them.

By shifting the workflow from **prompt-driven** to **spec-driven**, Open Mission locks the AI into a strict execution loop. It pulls your issues, compiles them into explicit Implementation Blueprints, and forces the AI to execute one bounded task at a time.

### Core Capabilities

* 📦 **Isolated Git Worktrees (The Ultimate Sandbox)**
    Never let an AI hallucination corrupt your local workspace again. Open Mission automatically provisions a dedicated, isolated Git worktree for every active mission. The AI is physically constrained to this directory, leaving your primary branch pristine until the mission is verified and delivered.
* 🧠 **Zero-Garbage Execution (Fresh Context Windows)**
    AI agents suffer from "context rot" after 10-12 turns. Open Mission's workflow engine solves this by provisioning a fresh, stateless session for every single atomic task. Task 12 gets the same high-quality execution environment as Task 1.
* 📜 **Architectural Governance**
    Define your repository's specific engineering standards in a `.agents/constitution.md` file. Open Mission injects these laws into every task session, ensuring the AI respects your tech stack, formatting, and structural boundaries.
* 🎛️ **The Native Open Mission Host & Persistent Daemon**
    Steer missions through a shared Open Mission app hosted natively on the desktop. Open Mission launches the native host through Tauri while `open-missiond` keeps repository state and runtime orchestration alive in the background. A mission's reducer-backed state machine (`mission.json`) ensures you can reconnect later and resume exactly where you left off.
* 🛑 **Deterministic CI Gating & Human Checklists**
    Open Mission disables AI self-praise. An agent cannot simply claim a task is "done." Open Mission gates progress behind your actual CI pipeline, and allows you to inject `manual` verification tasks where a human operator must explicitly check off deliverables before the workflow proceeds.
* 🚨 **First-Class Pause & Governance Controls**
    Open Mission treats Human-in-the-Loop as a fundamental state. Pause the mission or stop a session to keep automated work under operator review while preserving durable workflow state.

---

## Installation & Quick Start

Open Mission is designed to be lightweight and frictionless to install in any existing repository.

Open Mission uses pnpm workspaces at the repository root and launches through the native Tauri host.

On Linux, `open-mission install` provisions the Open Mission-managed GitHub CLI automatically when it is missing, then records the resolved binary path in Open Mission config.

**1. Run the published CLI package:**

```bash
npx @flying-pillow/open-mission
```

Or install it globally if you want persistent `open-mission` and `open-missiond` commands:

```bash
npm install -g @flying-pillow/open-mission
open-mission
```
