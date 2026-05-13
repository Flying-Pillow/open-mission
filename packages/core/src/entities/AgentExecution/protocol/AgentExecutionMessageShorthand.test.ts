import { describe, expect, it } from 'vitest';
import { AgentExecution } from '../AgentExecution.js';
import { createAgentExecutionProtocolDescriptor } from './AgentExecutionProtocolDescriptor.js';
import { resolveAgentExecutionMessageShorthand } from './AgentExecutionMessageShorthand.js';

describe('AgentExecutionMessageShorthand', () => {
    const protocolDescriptor = createAgentExecutionProtocolDescriptor({
        scope: {
            kind: 'repository',
            repositoryRootPath: '/repo'
        },
        messages: AgentExecution.createSupportedMessagesForCommands(['interrupt', 'checkpoint', 'nudge'])
    });

    it('treats non-slash text as a structured operator prompt', () => {
        expect(resolveAgentExecutionMessageShorthand({
            text: 'Please inspect the failing tests.',
            protocolDescriptor
        })).toEqual({
            kind: 'prompt',
            commandId: 'agentExecution.sendPrompt',
            input: {
                source: 'operator',
                text: 'Please inspect the failing tests.'
            }
        });
    });

    it('resolves advertised cross-agent slash shorthand to a supported message', () => {
        expect(resolveAgentExecutionMessageShorthand({
            text: '/checkpoint before refactor',
            protocolDescriptor
        })).toMatchObject({
            kind: 'runtime-message',
            commandId: 'agentExecution.sendRuntimeMessage',
            input: {
                type: 'checkpoint',
                reason: 'before refactor'
            },
            descriptor: {
                type: 'checkpoint',
                portability: 'cross-agent'
            }
        });
    });

    it('resolves Mission-native read shorthand to a semantic operation', () => {
        expect(resolveAgentExecutionMessageShorthand({
            text: '/read docs/architecture/agent-interaction-structured-first-spec.md',
            protocolDescriptor
        })).toMatchObject({
            kind: 'semantic-operation',
            method: 'invokeSemanticOperation',
            input: {
                name: 'read_artifact',
                input: {
                    path: 'docs/architecture/agent-interaction-structured-first-spec.md'
                }
            },
            descriptor: {
                type: 'read',
                portability: 'mission-native'
            }
        });
    });

    it('rejects unknown slash shorthand outside the terminal lane', () => {
        expect(resolveAgentExecutionMessageShorthand({
            text: '/provider-only',
            protocolDescriptor
        })).toEqual({
            kind: 'parse-error',
            summary: "AgentExecution command '/provider-only' is not advertised by the active protocol descriptor.",
            commandName: 'provider-only',
            availableCommands: ['read', 'interrupt', 'checkpoint', 'nudge']
        });
    });

    it('allows unknown slash input only when explicitly resolving for the terminal lane', () => {
        expect(resolveAgentExecutionMessageShorthand({
            text: '/provider-only',
            protocolDescriptor,
            terminalLane: true
        })).toEqual({
            kind: 'terminal-input',
            method: 'sendTerminalInput',
            input: {
                data: '/provider-only',
                literal: true
            },
            reason: 'Command is not advertised by the AgentExecution protocol descriptor and was explicitly entered in the terminal lane.'
        });
    });

    it('requires terminal focus for descriptor-backed terminal-only commands', () => {
        const terminalOnlyDescriptor = createAgentExecutionProtocolDescriptor({
            scope: {
                kind: 'repository',
                repositoryRootPath: '/repo'
            },
            messages: [{
                type: 'native-login',
                label: 'Native Login',
                delivery: 'best-effort',
                mutatesContext: false,
                portability: 'terminal-only'
            }]
        });

        expect(resolveAgentExecutionMessageShorthand({
            text: '/native-login',
            protocolDescriptor: terminalOnlyDescriptor
        })).toMatchObject({
            kind: 'parse-error',
            commandName: 'native-login'
        });
        expect(resolveAgentExecutionMessageShorthand({
            text: '/native-login',
            protocolDescriptor: terminalOnlyDescriptor,
            terminalLane: true
        })).toMatchObject({
            kind: 'terminal-input',
            method: 'sendTerminalInput',
            input: {
                data: '/native-login',
                literal: true
            }
        });
    });

    it('routes descriptor-backed /model only through the terminal lane', () => {
        const modelDescriptor = createAgentExecutionProtocolDescriptor({
            scope: {
                kind: 'repository',
                repositoryRootPath: '/repo'
            },
            messages: [{
                type: 'model',
                label: 'Model',
                delivery: 'best-effort',
                mutatesContext: false,
                portability: 'terminal-only'
            }]
        });

        expect(resolveAgentExecutionMessageShorthand({
            text: '/model',
            protocolDescriptor: modelDescriptor
        })).toMatchObject({
            kind: 'parse-error',
            commandName: 'model'
        });
        expect(resolveAgentExecutionMessageShorthand({
            text: '/model',
            protocolDescriptor: modelDescriptor,
            terminalLane: true
        })).toMatchObject({
            kind: 'terminal-input',
            method: 'sendTerminalInput',
            input: {
                data: '/model',
                literal: true
            }
        });
    });

    it('resolves adapter-scoped descriptor shorthand to an adapter-scoped supported message', () => {
        const adapterScopedDescriptor = createAgentExecutionProtocolDescriptor({
            scope: {
                kind: 'repository',
                repositoryRootPath: '/repo'
            },
            messages: [{
                type: 'compact-provider-context',
                label: 'Compact Provider Context',
                delivery: 'best-effort',
                mutatesContext: false,
                portability: 'adapter-scoped',
                adapterId: 'example-cli'
            }]
        });

        expect(resolveAgentExecutionMessageShorthand({
            text: '/compact-provider-context before verification',
            protocolDescriptor: adapterScopedDescriptor
        })).toMatchObject({
            kind: 'runtime-message',
            commandId: 'agentExecution.sendRuntimeMessage',
            input: {
                type: 'compact-provider-context',
                portability: 'adapter-scoped',
                adapterId: 'example-cli',
                reason: 'before verification'
            },
            descriptor: {
                type: 'compact-provider-context',
                portability: 'adapter-scoped',
                adapterId: 'example-cli'
            }
        });
    });
});