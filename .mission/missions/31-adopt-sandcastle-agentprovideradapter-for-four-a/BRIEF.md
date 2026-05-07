---
issueId: 31
title: "Adopt Sandcastle `AgentProviderAdapter` for four agent coders without sandboxing"
type: "task"
branchRef: "mission/31-adopt-sandcastle-agentprovideradapter-for-four-a"
createdAt: "2026-05-04T07:01:50.223Z"
updatedAt: "2026-05-04T07:01:50.223Z"
url: "https://github.com/Flying-Pillow/mission/issues/31"
---

Issue: #31

## Background

Mission already owns the agent runtime boundary: `AgentRunner`, `AgentSession`, daemon-managed lifecycle, terminal attachment, logs, state, and Airport UI integration.

Sandcastle provides a useful `AgentProvider` abstraction for translating agent-coder intent into provider-specific CLI commands. It currently includes provider implementations for:

- Claude Code
- Pi
- Codex
- OpenCode

The goal of this issue is to consume Sandcastle as a dependency and adapt its exported agent providers into Mission’s runtime model, without adopting Sandcastle’s sandboxing, worktree, orchestration, or interactive execution layers.

## Goal

Add `@ai-hero/sandcastle` as a Mission dependency and introduce a Mission-owned `AgentProviderAdapter` that wraps Sandcastle’s exported `AgentProvider` factories.

Mission should use Sandcastle for provider-specific command construction and stream parsing, while Mission continues to own:

- agent session lifecycle
- Mission worktree selection
- daemon-owned terminal transport
- Airport terminal attach/input/resize behavior
- agent runtime messages
- agent session logs
- state-store updates

This should make the initial four Sandcastle-backed agent coders available in Mission:

- `claude-code`
- `pi`
- `codex`
- `opencode`

It should also create a small extension point so future Sandcastle providers can be added by registering additional exported provider factories, assuming they use the same public `AgentProvider` shape.

## Scope

Implement a dependency-backed adapter layer that:

1. Adds `@ai-hero/sandcastle` as a package dependency.
2. Imports Sandcastle’s exported agent provider factories.
3. Defines a Mission-owned adapter boundary around Sandcastle’s `AgentProvider` shape.
4. Maps Mission `AgentLaunchConfig` / `AgentPrompt` / provider metadata into Sandcastle provider options.
5. Uses Sandcastle `buildInteractiveArgs()` when launching an interactive terminal-backed agent session.
6. Uses Mission’s existing `TerminalAgentTransport` / `node-pty` transport to run the resulting command.
7. Optionally uses Sandcastle `buildPrintCommand()` / `parseStreamLine()` for non-interactive or structured output paths where that fits Mission’s runtime model.
8. Keeps provider-specific model, effort, resume, and permission options in Mission metadata rather than adding provider-specific fields to core runtime types.
9. Adds tests around command construction, provider registration, unsupported capability handling, and runtime integration boundaries.

## Non-goals

Do not adopt Sandcastle’s sandboxing or orchestration APIs in this issue.

Specifically, do not use:

- `run()`
- `interactive()`
- `createSandbox()`
- `createWorktree()`
- Docker sandbox providers
- Podman sandbox providers
- Vercel sandbox providers
- Daytona sandbox providers
- Sandcastle branch strategies
- Sandcastle worktree lifecycle management

Mission must continue to run agents inside the Mission-selected worktree using Mission’s daemon-owned runtime and terminal transport.

This issue is also not intended to change Airport’s terminal UI model.

## Proposed Design

Introduce a Mission-owned adapter layer, conceptually:

```ts
type MissionAgentProviderAdapter = {
  id: AgentRunnerId;
  label: string;
  capabilities: {
    interactive: boolean;
    print: boolean;
    streamParsing: boolean;
    sessionCapture: boolean;
  };
  buildInteractiveLaunch(request: MissionAgentProviderLaunchRequest): TerminalLaunchRequest;
  buildPrintLaunch?(request: MissionAgentProviderLaunchRequest): TerminalLaunchRequest;
  parseRuntimeOutput?(line: string): AgentRuntimeMessage[];
};
```

The implementation should wrap Sandcastle providers rather than exposing Sandcastle directly throughout Mission runtime code.

Conceptual example:

```ts
import {
  claudeCode,
  codex,
  opencode,
  pi,
} from "@ai-hero/sandcastle";

const provider = claudeCode({
  model,
  effort,
});

const args = provider.buildInteractiveArgs?.({
  prompt,
  dangerouslySkipPermissions,
  resumeSession,
});

return {
  command: args[0],
  args: args.slice(1),
  env: provider.env,
  workingDirectory: missionWorktreePath,
};
```

The exact constructor signatures should follow Sandcastle’s public exports at implementation time.

Mission should own the registry that maps Mission runner ids to Sandcastle provider factories, for example:

```ts
const sandcastleProviderRegistry = {
  "claude-code": createClaudeCodeProvider,
  pi: createPiProvider,
  codex: createCodexProvider,
  opencode: createOpenCodeProvider,
};
```

Future Sandcastle providers should become available by adding registry entries when Sandcastle exports compatible factories. Automatic discovery is only required if Sandcastle exposes a stable public provider registry.

## Provider Mapping

### Claude Code

Use Sandcastle’s Claude Code provider for command construction.

Support provider metadata for:

- model
- effort, if supported by Sandcastle/provider
- resume session, if supported
- permission bypass setting, mapped deliberately from Mission policy

Interactive launch should use `buildInteractiveArgs()` and Mission PTY transport.

### Pi

Replace or refactor the existing Mission Pi runner path so Pi can be launched through the Sandcastle-backed adapter.

Preserve Mission’s existing terminal behavior and session lifecycle.

### Codex

Add Codex as a Sandcastle-backed agent coder.

Support interactive launch if Sandcastle provider exposes `buildInteractiveArgs()`.

If only print/exec mode is available for a provider capability, Mission should surface that capability honestly rather than pretending it is interactive.

### OpenCode

Add OpenCode as a Sandcastle-backed agent coder.

Handle provider-specific limitations explicitly, especially if stream parsing is passthrough or unavailable.

## PTY and Airport UI Behavior

Mission should continue to use its existing daemon-owned terminal transport.

The launch flow should be:

1. Mission receives an agent launch request.
2. Mission resolves the selected Mission worktree.
3. Mission selects the Sandcastle-backed provider adapter.
4. Adapter asks Sandcastle provider for command/args.
5. Mission starts the command via `TerminalAgentTransport`.
6. Airport attaches to the Mission terminal session as it does today.
7. Operator input, resize, reconnect, and screen state continue through Mission’s existing terminal APIs.

This means operators should still be able to answer provider-native prompts inside the Airport terminal pane.

Sandcastle’s `interactive()` function should not be used because it hands the current process stdio directly to the provider command. Mission already has a richer daemon-owned PTY model with attach/resume/input/resize support.

## Dependency Boundary

Sandcastle should be treated as a provider-adapter dependency, not as Mission’s runtime.

Allowed dependency use:

- import exported provider factories
- import provider-related types if exported as public API
- call provider command builders
- call provider stream parsers where useful

Disallowed dependency use:

- Sandcastle sandbox creation
- Sandcastle worktree creation
- Sandcastle orchestration lifecycle
- Sandcastle branch strategy handling
- Sandcastle foreground interactive execution

If Sandcastle does not export enough stable provider-level API, document the missing exports and either:

1. open an upstream issue/PR to expose provider APIs, or
2. keep a very small Mission-owned compatibility type matching the public runtime shape while still importing the exported provider factories.

## Runtime Message Handling

Parsed Sandcastle output should be treated as runtime observation, not canonical Mission state.

Mission should continue to decide which observations become:

- agent runtime messages
- terminal session updates
- daemon audit logs
- state-store transactions

Raw terminal output remains daemon-owned session log material unless Mission explicitly promotes structured information into runtime messages.

## Acceptance Criteria

- `@ai-hero/sandcastle` is added as a dependency in the appropriate Mission package.
- Mission has a Sandcastle-backed `AgentProviderAdapter` boundary.
- Claude Code, Pi, Codex, and OpenCode are available through the adapter registry.
- Interactive-capable providers launch through Mission’s existing PTY transport.
- Airport terminal attach/input/resize/reconnect behavior still works for Sandcastle-backed providers.
- No Sandcastle sandbox, worktree, branch strategy, `run()`, or `interactive()` APIs are used.
- Provider-specific options are carried through Mission metadata or adapter-specific config, not added as broad core runtime fields.
- Unsupported provider capabilities produce clear runtime errors or unavailable states.
- Existing Mission runtime abstractions remain the owner of lifecycle, state, logs, and terminal behavior.
- Tests cover all four provider registrations and their command-building behavior.
- Tests verify that Mission invokes `TerminalAgentTransport` with Sandcastle-built command/args.
- Tests verify that missing `buildInteractiveArgs()` is handled explicitly.
- Tests verify that parsed stream output, where supported, is converted only into Mission runtime observations.

## Test Plan

Add focused tests for:

- Sandcastle provider registry contains Claude Code, Pi, Codex, and OpenCode.
- Each provider can produce a Mission terminal launch request.
- Interactive providers use `buildInteractiveArgs()` and then Mission PTY transport.
- Print-only behavior, if exposed, uses `buildPrintCommand()` without bypassing Mission runtime ownership.
- Provider environment variables are merged through Mission’s existing environment handling.
- Provider metadata such as model, effort, resume session, and permission settings is mapped correctly.
- Unsupported capabilities fail with clear errors.
- Sandcastle orchestration APIs are not imported or called by Mission runtime code.

## Documentation

Update the relevant Mission runtime documentation to explain:

- Mission depends on Sandcastle for provider command adapters.
- Sandcastle does not own Mission agent sessions.
- Mission does not use Sandcastle sandboxing in this integration.
- Airport continues to provide the interactive terminal for agent coders.
- Adding future Sandcastle providers requires registering compatible exported provider factories behind Mission’s adapter boundary.
