// /apps/airport/web/src/lib/client/entities/AgentSession.ts: OO browser entity for a mission agent session hydrated from validated DTOs.
import type {
    AgentCommandDto as AgentCommand,
    AgentPromptDto as AgentPrompt,
    MissionAgentSessionDto
} from '@flying-pillow/mission-core/airport/runtime';
import type { EntityModel } from '$lib/client/entities/EntityModel';

export type AgentSessionCommandOwner = {
    completeSession(sessionId: string): Promise<void>;
    cancelSession(sessionId: string, reason?: string): Promise<void>;
    terminateSession(sessionId: string, reason?: string): Promise<void>;
    sendSessionPrompt(sessionId: string, prompt: AgentPrompt): Promise<void>;
    sendSessionCommand(sessionId: string, command: AgentCommand): Promise<void>;
};

export class AgentSession implements EntityModel<MissionAgentSessionDto> {
    private data: MissionAgentSessionDto;
    private readonly owner: AgentSessionCommandOwner;

    public constructor(data: MissionAgentSessionDto, owner: AgentSessionCommandOwner) {
        this.data = structuredClone(data);
        this.owner = owner;
    }

    public get sessionId(): string {
        return this.data.sessionId;
    }

    public get id(): string {
        return this.sessionId;
    }

    public get taskId(): string | undefined {
        return this.data.taskId;
    }

    public get lifecycleState(): MissionAgentSessionDto['lifecycleState'] {
        return this.data.lifecycleState;
    }

    public get transportId(): string | undefined {
        return this.data.transportId;
    }

    public get currentTurnTitle(): string | undefined {
        return this.data.currentTurnTitle;
    }

    public get workingDirectory(): string | undefined {
        return this.data.workingDirectory;
    }

    public get terminalSessionName(): string | undefined {
        return this.data.terminalSessionName;
    }

    public get terminalPaneId(): string | undefined {
        return this.data.terminalPaneId;
    }

    public get terminalHandle(): MissionAgentSessionDto['terminalHandle'] {
        return this.data.terminalHandle;
    }

    public isRunning(): boolean {
        return this.lifecycleState === 'starting'
            || this.lifecycleState === 'running'
            || this.lifecycleState === 'awaiting-input';
    }

    public isTerminalBacked(): boolean {
        return this.transportId === 'terminal'
            && Boolean(this.terminalHandle?.sessionName || this.terminalSessionName);
    }

    public async sendPrompt(prompt: AgentPrompt): Promise<this> {
        await this.owner.sendSessionPrompt(this.sessionId, prompt);
        return this;
    }

    public async sendCommand(command: AgentCommand): Promise<this> {
        await this.owner.sendSessionCommand(this.sessionId, command);
        return this;
    }

    public async done(): Promise<this> {
        await this.owner.completeSession(this.sessionId);
        return this;
    }

    public async cancel(reason?: string): Promise<this> {
        await this.owner.cancelSession(this.sessionId, reason);
        return this;
    }

    public async terminate(reason?: string): Promise<this> {
        await this.owner.terminateSession(this.sessionId, reason);
        return this;
    }

    public updateFromSnapshot(data: MissionAgentSessionDto): this {
        this.data = structuredClone(data);
        return this;
    }

    public update(data: MissionAgentSessionDto): this {
        return this.updateFromSnapshot(data);
    }

    public toSnapshot(): MissionAgentSessionDto {
        return structuredClone(this.data);
    }

    public toJSON(): MissionAgentSessionDto {
        return this.toSnapshot();
    }
}