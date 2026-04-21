import * as path from 'node:path';
import type { MissionRepositoryCandidate, MissionSelectionCandidate, OperatorStatus } from '../types.js';
import {
    METHOD_METADATA,
    type ControlRepositoriesAdd,
    type Method,
    type Notification,
    type Request
} from '../daemon/protocol/contracts.js';
import { MissionWorkspace } from './Workspace.js';
import type { AgentRunner } from '../agent/AgentRunner.js';
import { listRegisteredMissionUserRepos, registerMissionUserRepo } from '../lib/userConfig.js';
import { resolveGitWorkspaceRoot } from '../lib/workspacePaths.js';
import { resolveMissionWorkspaceContext } from '../lib/workspacePaths.js';
import type { MissionControlSource } from '../daemon/control-plane/types.js';

export class WorkspaceManager {
    private readonly workspaces = new Map<string, MissionWorkspace>();

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

    public resolveWorkspaceRootForSurfacePath(surfacePath: string): string {
        return path.resolve(this.discoverSurfaceRoot(surfacePath));
    }

    public async readMissionControlSource(input: {
        surfacePath?: string;
        workspaceRoot?: string;
        selectedMissionId?: string;
        missionStatusHint?: OperatorStatus;
    }): Promise<MissionControlSource> {
        const workspaceRoot = input.workspaceRoot
            ? path.resolve(input.workspaceRoot)
            : input.surfacePath
                ? this.resolveWorkspaceRootForSurfacePath(input.surfacePath)
                : undefined;
        if (!workspaceRoot) {
            throw new Error('Mission control source requires a surfacePath or workspaceRoot.');
        }
        const workspace = this.getWorkspace(workspaceRoot);
        const availableRepositories = await this.listRegisteredRepositories(workspaceRoot);
        return workspace.readMissionControlSource({
            availableRepositories,
            ...(input.selectedMissionId?.trim() ? { selectedMissionId: input.selectedMissionId.trim() } : {}),
            ...(input.missionStatusHint ? { missionStatusHint: input.missionStatusHint } : {})
        });
    }

    public resolveWorkspaceRootForRequest(request: Request, result: unknown): string | undefined {
        void result;
        const surfacePath = request.surfacePath?.trim();
        if (surfacePath) {
            return this.resolveWorkspaceRootForSurfacePath(surfacePath);
        }
        return undefined;
    }

    public async executeMethod(request: Request): Promise<unknown> {
        if (isControlMethod(request.method)) {
            return this.executeControlMethod(request);
        }

        const missionId = readMissionSelector(request.params)?.missionId;
        if (!missionId) {
            throw new Error(`Mission method '${request.method}' requires an explicit missionId selector.`);
        }
        const surfacePath = request.surfacePath?.trim();
        if (!surfacePath) {
            throw new Error(`Mission method '${request.method}' requires a surfacePath.`);
        }
        return this.executeMissionMethod(surfacePath, request);
    }

    private async executeControlMethod(request: Request): Promise<unknown> {
        const surfacePath = request.surfacePath?.trim();
        if (!surfacePath) {
            throw new Error(`Control method '${request.method}' requires a surfacePath.`);
        }

        const discovery = await this.discoverSurface(surfacePath);
        const primaryWorkspace = this.getWorkspace(discovery.primaryControlRoot);
        const availableMissions = await this.collectAvailableMissions(discovery.controlRoots);
        const availableRepositories = await this.listRegisteredRepositories(discovery.primaryControlRoot);

        if (request.method === 'control.status') {
            const status = await primaryWorkspace.buildDiscoveryStatus(availableMissions);
            return {
                ...status,
                availableRepositories
            };
        }

        if (request.method === 'control.repositories.list') {
            return availableRepositories;
        }

        if (request.method === 'control.github.repositories.list') {
            return primaryWorkspace.executeMethod(request);
        }

        if (request.method === 'control.github.repositories.clone') {
            return primaryWorkspace.executeMethod(request);
        }

        if (request.method === 'control.github.issue.detail') {
            return primaryWorkspace.executeMethod(request);
        }

        if (request.method === 'control.repositories.add') {
            const params = (request.params ?? {}) as ControlRepositoriesAdd;
            const candidate = await this.addKnownRepository(params.repositoryPath);
            return candidate;
        }

        const result = await primaryWorkspace.executeMethod(request);
        return result;
    }

    private async listRegisteredRepositories(workspaceRoot: string): Promise<MissionRepositoryCandidate[]> {
        void workspaceRoot;
        return listRegisteredMissionUserRepos();
    }

    private async addKnownRepository(repositoryPath: string): Promise<MissionRepositoryCandidate> {
        const trimmedPath = repositoryPath.trim();
        if (!trimmedPath) {
            throw new Error('Repository path is required.');
        }
        const controlRoot = resolveGitWorkspaceRoot(trimmedPath) ?? path.resolve(trimmedPath);
        if (!resolveGitWorkspaceRoot(controlRoot) && !resolveGitWorkspaceRoot(trimmedPath)) {
            throw new Error(`Mission could not resolve a Git repository from '${repositoryPath}'.`);
        }
        await registerMissionUserRepo(controlRoot);
        const repos = await this.listRegisteredRepositories(controlRoot);
        const registered = repos.find((candidate) => candidate.repositoryRootPath === controlRoot);
        if (!registered) {
            throw new Error(`Mission could not register repository '${repositoryPath}'.`);
        }
        return registered;
    }

    private async executeMissionMethod(surfacePath: string, request: Request): Promise<unknown> {
        const workspaceRoot = this.resolveWorkspaceRootForSurfacePath(surfacePath);
        return this.getWorkspace(workspaceRoot).executeMethod(request);
    }

    private async collectAvailableMissions(controlRoots: string[]): Promise<MissionSelectionCandidate[]> {
        const discovered: MissionSelectionCandidate[] = [];
        for (const controlRoot of controlRoots) {
            const workspace = this.getWorkspace(controlRoot);
            const candidates = await workspace.listMissionSelectionCandidates();
            for (const candidate of candidates) {
                discovered.push(candidate);
            }
        }
        return discovered.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
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

    private discoverSurfaceRoot(surfacePath: string): string {
        const normalizedSurfacePath = path.resolve(surfacePath);
        return this.resolveControlRootFromMissionPath(normalizedSurfacePath)
            ?? resolveGitWorkspaceRoot(normalizedSurfacePath)
            ?? normalizedSurfacePath;
    }

    private resolveControlRootFromMissionPath(surfacePath: string): string | undefined {
        const context = resolveMissionWorkspaceContext(surfacePath);
        return context.kind === 'mission-worktree'
            ? context.workspaceRoot
            : undefined;
    }
}

function isControlMethod(method: Method): boolean {
    return METHOD_METADATA[method].workspaceRoute === 'control';
}

function readMissionSelector(params: unknown): { missionId?: string } | undefined {
    if (!params || typeof params !== 'object' || !('selector' in params)) {
        return undefined;
    }
    const selector = (params as { selector?: { missionId?: string } }).selector;
    return selector && typeof selector === 'object' ? selector : undefined;
}