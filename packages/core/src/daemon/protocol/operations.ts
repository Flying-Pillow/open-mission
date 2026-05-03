export const PROTOCOL_VERSION = 28;

export type Method =
    | 'ping'
    | 'event.subscribe'
    | 'system.status'
    | 'entity.query'
    | 'entity.command';

export type MethodWorkspaceRoute = 'none' | 'control' | 'mission';

export type MethodMetadata = {
    includeSurfacePath: boolean;
    workspaceRoute: MethodWorkspaceRoute;
};

export const METHOD_METADATA: Record<Method, MethodMetadata> = {
    'ping': { includeSurfacePath: false, workspaceRoute: 'none' },
    'event.subscribe': { includeSurfacePath: false, workspaceRoute: 'none' },
    'system.status': { includeSurfacePath: true, workspaceRoute: 'none' },
    'entity.query': { includeSurfacePath: true, workspaceRoute: 'control' },
    'entity.command': { includeSurfacePath: true, workspaceRoute: 'control' }
};
