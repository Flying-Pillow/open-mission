import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { MissionSelectionCandidate, OperatorStatus } from '../../types.js';
import { Repository } from './Repository.js';
import {
    METHOD_METADATA,
    type ControlRepositoriesAdd,
    type Method,
    type Notification,
    type Request
} from '../../daemon/protocol/contracts.js';
import { RepositoryRuntime } from './RepositoryRuntime.js';
import type { AgentRunner } from '../../agent/AgentRunner.js';
import { registerMissionRepo } from '../../lib/config.js';
import { resolveGitWorkspaceRoot } from '../../lib/workspacePaths.js';
import { resolveMissionWorkspaceContext } from '../../lib/workspacePaths.js';
import type { ControlSource } from '../../daemon/control-plane/types.js';

export class RepositoryManager {
    private readonly repositories = new Map<string, RepositoryRuntime>();

    public constructor(
        private readonly runners: Map<string, AgentRunner>,
        private readonly emitEvent: (event: Notification) => void
    ) { }

    public getRepository(repositoryRoot: string): RepositoryRuntime {
        const normalizedRepositoryRoot = path.resolve(repositoryRoot);
        let repository = this.repositories.get(normalizedRepositoryRoot);
        if (!repository) {
            repository = new RepositoryRuntime(
                normalizedRepositoryRoot,
                this.runners,
                this.emitEvent
            );
            this.repositories.set(normalizedRepositoryRoot, repository);
        }

        return repository;
    }

    public resolveRepositoryRootForSurfacePath(surfacePath: string): string {
        return path.resolve(this.discoverSurfaceRoot(surfacePath));
    }

    public async readControlSource(input: {
        surfacePath?: string;
        repositoryRoot?: string;
        selectedMissionId?: string;
        missionStatusHint?: OperatorStatus;
    }): Promise<ControlSource> {
        const repositoryRoot = input.repositoryRoot
            ? path.resolve(input.repositoryRoot)
            : input.surfacePath
                ? this.resolveRepositoryRootForSurfacePath(input.surfacePath)
                : undefined;
        if (!repositoryRoot) {
            throw new Error('Mission control source requires a surfacePath or repositoryRoot.');
        }
        const repository = this.getRepository(repositoryRoot);
        const availableRepositories = await this.listRegisteredRepositories(repositoryRoot);
        return repository.readControlSource({
            availableRepositories,
            ...(input.selectedMissionId?.trim() ? { selectedMissionId: input.selectedMissionId.trim() } : {}),
            ...(input.missionStatusHint ? { missionStatusHint: input.missionStatusHint } : {})
        });
    }

    public resolveRepositoryRootForRequest(request: Request, result: unknown): string | undefined {
        void result;
        const surfacePath = request.surfacePath?.trim();
        if (surfacePath) {
            return this.resolveRepositoryRootForSurfacePath(surfacePath);
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
        const controlStatusParams = request.method === 'control.status' && request.params && typeof request.params === 'object'
            ? request.params as { includeMissions?: boolean }
            : undefined;
        const includeMissions = controlStatusParams?.includeMissions !== false;

        const totalStartedAt = request.method === 'control.status' ? performance.now() : 0;
        const discoverStartedAt = request.method === 'control.status' ? performance.now() : 0;

        const discovery = await this.discoverSurface(surfacePath);
        const discoverDurationMs = request.method === 'control.status'
            ? performance.now() - discoverStartedAt
            : 0;
        const primaryRepository = this.getRepository(discovery.primaryControlRoot);
        const missionsStartedAt = request.method === 'control.status' ? performance.now() : 0;
        const availableMissions = includeMissions
            ? await this.collectAvailableMissions(discovery.controlRoots)
            : [];
        const missionsDurationMs = request.method === 'control.status'
            ? performance.now() - missionsStartedAt
            : 0;
        const repositoriesStartedAt = request.method === 'control.status' ? performance.now() : 0;
        const availableRepositories = await this.listRegisteredRepositories(discovery.primaryControlRoot);
        const repositoriesDurationMs = request.method === 'control.status'
            ? performance.now() - repositoriesStartedAt
            : 0;

        if (request.method === 'control.status') {
            const statusStartedAt = performance.now();
            const status = await primaryRepository.buildRepositoryDiscoveryStatus(availableMissions);
            const statusDurationMs = performance.now() - statusStartedAt;
            const totalDurationMs = performance.now() - totalStartedAt;
            process.stdout.write(
                `${new Date().toISOString().slice(11, 19)} control.status repositoryManager total=${totalDurationMs.toFixed(1)}ms discover=${discoverDurationMs.toFixed(1)}ms missions=${missionsDurationMs.toFixed(1)}ms repositories=${repositoriesDurationMs.toFixed(1)}ms buildStatus=${statusDurationMs.toFixed(1)}ms includeMissions=${String(includeMissions)}\n`
            );
            return {
                ...status,
                availableRepositories
            };
        }

        if (request.method === 'control.repositories.list') {
            return availableRepositories;
        }

        if (request.method === 'control.github.repositories.list') {
            return primaryRepository.executeMethod(request);
        }

        if (request.method === 'control.github.repositories.clone') {
            return primaryRepository.executeMethod(request);
        }

        if (request.method === 'control.github.issue.detail') {
            return primaryRepository.executeMethod(request);
        }

        if (request.method === 'control.repositories.add') {
            const params = (request.params ?? {}) as ControlRepositoriesAdd;
            const candidate = await this.addKnownRepository(params.repositoryPath);
            return candidate;
        }

        const result = await primaryRepository.executeMethod(request);
        return result;
    }

    private async listRegisteredRepositories(repositoryRoot: string): Promise<Repository[]> {
        void repositoryRoot;
        const startedAt = performance.now();
        const repositories = await Repository.find();
        const durationMs = performance.now() - startedAt;
        process.stdout.write(
            `${new Date().toISOString().slice(11, 19)} repositories.listRegistered count=${String(repositories.length)} duration=${durationMs.toFixed(1)}ms\n`
        );
        return repositories;
    }

    private async addKnownRepository(repositoryPath: string): Promise<Repository> {
        const trimmedPath = repositoryPath.trim();
        if (!trimmedPath) {
            throw new Error('Repository path is required.');
        }
        const controlRoot = resolveGitWorkspaceRoot(trimmedPath) ?? path.resolve(trimmedPath);
        if (!resolveGitWorkspaceRoot(controlRoot) && !resolveGitWorkspaceRoot(trimmedPath)) {
            throw new Error(`Mission could not resolve a Git repository from '${repositoryPath}'.`);
        }
        await registerMissionRepo(controlRoot);
        const repos = await this.listRegisteredRepositories(controlRoot);
        const registered = repos.find((candidate) => candidate.repositoryRootPath === controlRoot);
        if (!registered) {
            throw new Error(`Mission could not register repository '${repositoryPath}'.`);
        }
        return registered;
    }

    private async executeMissionMethod(surfacePath: string, request: Request): Promise<unknown> {
        const repositoryRoot = this.resolveRepositoryRootForSurfacePath(surfacePath);
        return this.getRepository(repositoryRoot).executeMethod(request);
    }

    private async collectAvailableMissions(controlRoots: string[]): Promise<MissionSelectionCandidate[]> {
        const discovered: MissionSelectionCandidate[] = [];
        for (const controlRoot of controlRoots) {
            const repository = this.getRepository(controlRoot);
            const candidates = await repository.listMissionSelectionCandidates();
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
