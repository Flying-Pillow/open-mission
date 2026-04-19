// /apps/airport/web/src/lib/client/entities/AgentSession.ts: OO browser entity for a mission agent session hydrated from validated DTOs.
import type { MissionAgentSessionDto } from '@flying-pillow/mission-core';
import type { EntityModel } from '$lib/client/entities/EntityModel';

export class AgentSession implements EntityModel<MissionAgentSessionDto> {
    private data: MissionAgentSessionDto;

    public constructor(data: MissionAgentSessionDto) {
        this.data = structuredClone(data);
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