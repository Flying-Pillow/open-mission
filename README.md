🚧 Mission is currently in Public Alpha (Developer Preview).
We (a 2-person team) are using this daily to build our own software, but the API and state machine are still evolving. You might encounter bugs. If you want to help us build the ultimate AI orchestration engine, drop a comment, open an issue, or try it out in a safe repository!

# 🌍 Mission

**The orchestration engine for AI-driven software development.**

Mission is a local state machine, terminal UI, and governance layer that sits between your issue tracker and your AI coding agents. It brings predictability, architectural strictness, and deterministic verification to AI-assisted development.

If you have ever spent hours untangling AI-generated "spaghetti code," fighting context rot in a long chat session, or fixing an active branch that an AI just trashed, Mission provides the structural guardrails to make AI development safe, scalable, and crash-proof.

---

## The AI Coding Landscape: Why Mission?

The AI coding space has evolved rapidly, but existing tools suffer from severe architectural limitations. Here is how Mission compares to the current ecosystem:

| Feature / System | SpecKit | BMAD | GSD | 🌍 Mission |
| :--- | :--- | :--- | :--- | :--- |
| **Primary Paradigm** | Spec formatting | Agile team simulation | CLI prompt orchestrator | **State Machine / Daemon** |
| **Context Management** | None | Agent memory (rots) | Fresh context per task | **Stateless Sessions + `mission.json`** |
| **Execution Safety** | None | None | Modifies active branch | **Isolated Git Worktrees** |
| **State Resilience** | None | None | CLI script (brittle if crashed) | **Reducer-based (Crash-proof)** |
| **User Interface** | CLI | CLI / Chat | Scrolling Terminal Text | **Interactive TUI (Tower/Pilot)** |
| **Human-in-the-Loop** | Upfront only | Chat-based | Yes | **Native (Pause, Panic, Manual Tasks)** |

*   **SpecKit** helps you write a prompt, but abandons you during execution.
*   **BMAD** forces AI to roleplay as PMs and Architects, leading to massive overhead and hallucinated agreements in giant context windows.
*   **GSD (Get Shit Done)** proved that developers want spec-driven, vertically-sliced tasks in fresh context windows. But because it relies on brittle CLI scripts executing directly on your active branch, it lacks safety and state recovery.
*   **Mission** takes the best theoretical concepts of spec-driven execution and implements them with **architectural strictness and enterprise-grade resilience**.

## The Solution: Air Traffic Control for your Repo

Mission does not replace your AI agents (Copilot, Claude, Cursor, Aider); it manages them. 

By shifting the workflow from **prompt-driven** to **spec-driven**, Mission locks the AI into a strict execution loop. It pulls your issues, compiles them into explicit Implementation Blueprints, and forces the AI to execute one bounded task at a time.

### Core Capabilities

*   📦 **Isolated Git Worktrees (The Ultimate Sandbox)** 
    Never let an AI hallucination corrupt your local workspace again. Mission automatically provisions a dedicated, isolated Git worktree for every active mission. The AI is physically jailed to this directory, leaving your primary branch completely pristine until the mission is verified and delivered.
*   🧠 **Zero-Garbage Execution (Fresh Context Windows)** 
    AI agents suffer from "context rot" after 10-12 turns. Mission's workflow engine solves this by provisioning a completely fresh, stateless session for every single atomic task. Task 12 gets the exact same high-quality execution environment as Task 1.
*   📜 **Architectural Governance** 
    Define your repository's specific engineering standards in a `.agents/constitution.md` file. Mission injects these laws into every task session, ensuring the AI respects your tech stack, formatting, and structural boundaries.
*   🎛️ **The Interactive Tower & Persistent Daemon** 
    Steer missions through a powerful Terminal User Interface (TUI). Because Mission runs as a persistent background daemon, you can safely detach from the tower, close your terminal, or reboot your machine. Mission's pure reducer-based state machine (`mission.json`) ensures you can reconnect later and resume exactly where you left off.
*   🛑 **Deterministic CI Gating & Human Checklists** 
    Mission disables AI self-praise. An agent cannot simply claim a task is "done." Mission gates progress behind your actual CI pipeline, and allows you to inject `manual` verification tasks where the human Principal Architect must explicitly check off deliverables before the workflow proceeds.
*   🚨 **First-Class Panic & Governance Controls**
    Mission treats Human-in-the-Loop as a fundamental state. Hit the "Panic" command to instantly sever the AI's terminal transport, halt the queue, and prevent any further automated work until a human reviews the situation.

---

## Installation & Quick Start

Mission is designed to be lightweight and frictionless to install in any existing repository.

**1. Install globally:**
```bash
npm install -g @flying-pillow/mission
mission