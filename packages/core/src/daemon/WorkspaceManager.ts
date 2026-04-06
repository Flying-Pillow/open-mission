import * as path from 'node:path';
import type { MissionSelectionCandidate } from '../types.js';
import type { Notification, Request } from './contracts.js';
import { MissionWorkspace } from './Workspace.js';
import type { AgentRunner } from '../runtime/AgentRunner.js';
import { resolveGitWorkspaceRoot } from '../lib/workspacePaths.js';

export class WorkspaceManager {
    private readonly workspaces = new Map<string, MissionWorkspace>();
    private readonly missionWorkspaceRoots = new Map<string, string>();

    public constructor(
        private readonly runners: Map<string, AgentRunner>,
        private readonly emitEvent: (event: Notification) => void
    ) { }

    public getWorkspace(workspaceRoot: string): MissionWorkspace {
        const normalizedWorkspaceRoot = path.resolve(workspaceRoot);
        let workspace = this.workspaces.get(normalizedWorkspaceRoot);
        if (!workspace) {
            workspace = new MissionWorkspace(
                normalizedWorkspaceRoot,
                this.runners,
                this.emitEvent
            );
            this.workspaces.set(normalizedWorkspaceRoot, workspace);
        }

        return workspace;
    }

    public async executeMethod(request: Request): Promise<unknown> {
        if (isControlMethod(request.method)) {
            return this.executeControlMethod(request);
        }

        const missionId = readMissionSelector(request.params)?.missionId;
        if (!missionId) {
            throw new Error(`Mission method '${request.method}' requires an explicit missionId selector.`);
        }
        return this.executeMissionMethod(missionId, request);
    }

    private async executeControlMethod(request: Request): Promise<unknown> {
        const surfacePath = request.surfacePath?.trim();
        if (!surfacePath) {
            throw new Error(`Control method '${request.method}' requires a surfacePath.`);
        }

        const discovery = await this.discoverSurface(surfacePath);
        const primaryWorkspace = this.getWorkspace(discovery.primaryControlRoot);
        const availableMissions = await this.collectAvailableMissions(discovery.controlRoots);

        if (request.method === 'control.status') {
            return primaryWorkspace.buildDiscoveryStatus(availableMissions);
        }

        const result = await primaryWorkspace.executeMethod(request);
        this.registerMissionResult(discovery.primaryControlRoot, result);
        return result;
    }

    private async executeMissionMethod(missionId: string, request: Request): Promise<unknown> {
        const workspaceRoot = this.missionWorkspaceRoots.get(missionId);
        if (!workspaceRoot) {
            throw new Error(`Mission '${missionId}' is unknown to the daemon. Discover missions from a surface path before selecting one.`);
        }
        return this.getWorkspace(workspaceRoot).executeMethod(request);
    }

    private async collectAvailableMissions(controlRoots: string[]): Promise<MissionSelectionCandidate[]> {
        const discovered: MissionSelectionCandidate[] = [];
        for (const controlRoot of controlRoots) {
            const workspace = this.getWorkspace(controlRoot);
            const candidates = await workspace.listMissionSelectionCandidates();
            for (const candidate of candidates) {
                if (!this.missionWorkspaceRoots.has(candidate.missionId)) {
                    this.missionWorkspaceRoots.set(candidate.missionId, controlRoot);
                }
                discovered.push(candidate);
            }
        }
        return discovered.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    }

    private registerMissionResult(controlRoot: string, result: unknown): void {
        const missionId = readMissionIdFromResult(result);
        if (!missionId) {
            return;
        }
        this.missionWorkspaceRoots.set(missionId, controlRoot);
    }

    private async discoverSurface(surfacePath: string): Promise<{
        surfacePath: string;
        primaryControlRoot: string;
        controlRoots: string[];
    }> {
        const normalizedSurfacePath = path.resolve(surfacePath);
        const primaryControlRoot =
            this.resolveControlRootFromMissionPath(normalizedSurfacePath)
            ?? resolveGitWorkspaceRoot(normalizedSurfacePath)
            ?? normalizedSurfacePath;
        return {
            surfacePath: normalizedSurfacePath,
            primaryControlRoot,
            controlRoots: [primaryControlRoot]
        };
    }

    private resolveControlRootFromMissionPath(surfacePath: string): string | undefined {
        const parts = path.resolve(surfacePath).split(path.sep).filter(Boolean);
        const missionsIndex = parts.lastIndexOf('.missions');
        if (missionsIndex < 0) {
            return undefined;
        }
        if (parts[missionsIndex + 1] !== 'active') {
            return undefined;
        }
        if (!parts[missionsIndex + 2]) {
            return undefined;
        }
        const prefix = parts.slice(0, missionsIndex);
        return path.resolve(path.sep, ...prefix);
    }
}

function isControlMethod(method: Request['method']): boolean {
    return (
        method === 'control.status'
        || method === 'control.settings.update'
        || method === 'control.action.execute'
        || method === 'control.workflow.settings.get'
        || method === 'control.workflow.settings.initialize'
        || method === 'control.workflow.settings.update'
        || method === 'control.issues.list'
        || method === 'mission.from-brief'
        || method === 'mission.from-issue'
    );
}

function readMissionSelector(params: unknown): { missionId?: string } | undefined {
    if (!params || typeof params !== 'object' || !('selector' in params)) {
        return undefined;
    }
    const selector = (params as { selector?: { missionId?: string } }).selector;
    return selector && typeof selector === 'object' ? selector : undefined;
}

function readMissionIdFromResult(result: unknown): string | undefined {
    if (!result || typeof result !== 'object') {
        return undefined;
    }
    if ('missionId' in result && typeof result.missionId === 'string' && result.missionId.trim()) {
        return result.missionId;
    }
    if ('status' in result && result.status && typeof result.status === 'object') {
        const status = result.status as { missionId?: string };
        if (typeof status.missionId === 'string' && status.missionId.trim()) {
            return status.missionId;
        }
    }
    return undefined;
}