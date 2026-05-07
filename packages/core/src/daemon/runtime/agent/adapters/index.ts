export * from '../AgentAdapter.js';
export * from './ClaudeCode.js';
export * from './Codex.js';
export * from './Copilot.js';
export * from './OpenCode.js';
export * from './Pi.js';

import { claudeCode } from './ClaudeCode.js';
import { codex } from './Codex.js';
import { copilot } from './Copilot.js';
import { openCode } from './OpenCode.js';
import { pi } from './Pi.js';
import type { AgentInput } from '../AgentAdapter.js';

export const missionAgents: readonly AgentInput[] = [
    copilot,
    claudeCode,
    pi,
    codex,
    openCode
];
