import {
    AgentExecutionMessageDescriptorSchema,
    AgentExecutionMessageShorthandResolutionSchema,
    type AgentExecutionMessageDescriptorType,
    type AgentExecutionMessageShorthandResolutionType
} from './AgentExecutionProtocolSchema.js';
import { READ_ARTIFACT_OPERATION_NAME } from './AgentExecutionSemanticOperationSchema.js';

type MissionNativeCommandDefinition = {
    name: string;
    descriptor: AgentExecutionMessageDescriptorType;
    resolve(input: {
        argumentText: string;
        availableCommands: string[];
    }): AgentExecutionMessageShorthandResolutionType;
};

const readArtifactCommandDescriptor = AgentExecutionMessageDescriptorSchema.parse({
    type: 'read',
    label: 'Read Artifact',
    description: 'Read a repository-relative artifact through Mission semantic access.',
    icon: 'lucide:file-search',
    tone: 'neutral',
    delivery: 'best-effort',
    mutatesContext: false,
    portability: 'mission-native'
});

export class AgentExecutionMissionNativeCommandRegistry {
    private readonly definitions: MissionNativeCommandDefinition[];

    public constructor(definitions: MissionNativeCommandDefinition[] = createDefaultMissionNativeCommandDefinitions()) {
        this.definitions = definitions;
    }

    public listCommandNames(): string[] {
        return this.definitions.map((definition) => definition.name);
    }

    public listDescriptors(): AgentExecutionMessageDescriptorType[] {
        return this.definitions.map((definition) => ({
            ...definition.descriptor,
            ...(definition.descriptor.input ? { input: { ...definition.descriptor.input } } : {})
        }));
    }

    public resolve(input: {
        commandName: string;
        argumentText: string;
        availableCommands: string[];
    }): AgentExecutionMessageShorthandResolutionType | undefined {
        return this.definitions
            .find((definition) => definition.name === input.commandName)
            ?.resolve({
                argumentText: input.argumentText,
                availableCommands: input.availableCommands
            });
    }
}

export const defaultAgentExecutionMissionNativeCommandRegistry = new AgentExecutionMissionNativeCommandRegistry();

function createDefaultMissionNativeCommandDefinitions(): MissionNativeCommandDefinition[] {
    return [
        {
            name: 'read',
            descriptor: readArtifactCommandDescriptor,
            resolve: ({ argumentText, availableCommands }) => {
                const path = argumentText.trim();
                if (!path) {
                    return AgentExecutionMessageShorthandResolutionSchema.parse({
                        kind: 'parse-error',
                        summary: "Mission-native command '/read' requires a repository-relative artifact path.",
                        commandName: 'read',
                        availableCommands
                    });
                }

                return AgentExecutionMessageShorthandResolutionSchema.parse({
                    kind: 'semantic-operation',
                    method: 'invokeSemanticOperation',
                    input: {
                        name: READ_ARTIFACT_OPERATION_NAME,
                        input: { path }
                    },
                    descriptor: readArtifactCommandDescriptor
                });
            }
        }
    ];
}