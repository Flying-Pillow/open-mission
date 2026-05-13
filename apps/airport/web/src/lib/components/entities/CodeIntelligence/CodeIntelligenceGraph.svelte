<script lang="ts">
    import { onMount } from "svelte";
    import type {
        CodeIntelligenceFileType,
        CodeIntelligenceIndexType,
        CodeIntelligenceRelationType,
        CodeIntelligenceSymbolType,
    } from "@flying-pillow/mission-core/entities/CodeIntelligence/CodeIntelligenceSchema";
    import type { DirectedGraph as GraphologyDirectedGraph } from "graphology";
    import type Sigma from "sigma";
    import Icon from "@iconify/svelte";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import { Checkbox } from "$lib/components/ui/checkbox/index.js";

    type KnowledgeGraphEntityType = "file" | "symbol";
    type KnowledgeGraphEdgeKind = "imports" | "defines";
    type KnowledgeGraphSymbolKind = CodeIntelligenceSymbolType["kind"];

    type KnowledgeGraphNode = {
        id: string;
        path: string;
        label: string;
        entityType: KnowledgeGraphEntityType;
        symbolKind?: KnowledgeGraphSymbolKind;
        filePath?: string;
        group: string;
        color: string;
        x: number;
        y: number;
        radius: number;
        importCount: number;
        importedByCount: number;
        symbolCount: number;
        degree: number;
        hidden: boolean;
    };

    type KnowledgeGraphEdge = {
        id: string;
        kind: KnowledgeGraphEdgeKind;
        from: string;
        to: string;
        count: number;
    };

    type KnowledgeGraph = {
        nodes: KnowledgeGraphNode[];
        edges: KnowledgeGraphEdge[];
        visibleFileCount: number;
        visibleSymbolCount: number;
        hiddenFileCount: number;
        resolvedRelationCount: number;
        unresolvedRelationCount: number;
        importEdgeCount: number;
        definitionEdgeCount: number;
    };

    type KnowledgeGraphFilters = {
        showFiles: boolean;
        showSymbols: boolean;
        showImports: boolean;
        symbolKinds: Record<KnowledgeGraphSymbolKind, boolean>;
    };

    type SigmaNodeAttributes = {
        x: number;
        y: number;
        size: number;
        label: string;
        color: string;
        baseColor: string;
        entityType: KnowledgeGraphEntityType;
        symbolKind?: KnowledgeGraphSymbolKind;
        filePath?: string;
        path: string;
        forceLabel: boolean;
        zIndex: number;
    };

    type SigmaEdgeAttributes = {
        size: number;
        label: string;
        color: string;
        baseColor: string;
        type: "arrow" | "line";
        edgeKind: KnowledgeGraphEdgeKind;
        count: number;
        zIndex: number;
    };

    type SigmaCodeGraph = GraphologyDirectedGraph<
        SigmaNodeAttributes,
        SigmaEdgeAttributes
    >;
    type SigmaCodeRenderer = Sigma<SigmaNodeAttributes, SigmaEdgeAttributes>;
    type DirectedGraphConstructor = typeof import("graphology").DirectedGraph;

    const GRAPH_WIDTH = 960;
    const GRAPH_HEIGHT = 660;
    const MAX_VISIBLE_NODES = 72;
    const MAX_VISIBLE_SYMBOLS = 120;
    const MIN_GRAPH_ZOOM = 0.65;
    const MAX_GRAPH_ZOOM = 2.4;
    const GRAPH_ZOOM_STEP = 0.15;
    const NODE_PALETTE = [
        "#d45a55",
        "#48a366",
        "#4b83c6",
        "#b65bbb",
        "#b79a31",
        "#3e9aa6",
    ];
    const SYMBOL_KIND_PALETTE: Record<KnowledgeGraphSymbolKind, string> = {
        class: "#d5863f",
        function: "#48aa74",
        interface: "#5d7fd5",
        type: "#bb63bd",
        const: "#aeb33f",
        let: "#5598aa",
        var: "#bd6b5b",
    };
    const SIGMA_MUTED_NODE_COLOR = "#36414d";
    const SIGMA_MUTED_EDGE_COLOR = "#303a45";
    const SIGMA_FOCUSED_NODE_COLOR = "#eef4f8";
    const SIGMA_IMPORT_EDGE_COLOR = "#8192a7";
    const SIGMA_DEFINITION_EDGE_COLOR = "#637185";
    const SYMBOL_KIND_LABELS: Record<KnowledgeGraphSymbolKind, string> = {
        class: "Classes",
        function: "Functions",
        interface: "Interfaces",
        type: "Types",
        const: "Constants",
        let: "Lets",
        var: "Vars",
    };
    const SYMBOL_KIND_OPTIONS: Array<{
        kind: KnowledgeGraphSymbolKind;
        label: string;
    }> = [
        { kind: "class", label: SYMBOL_KIND_LABELS.class },
        { kind: "function", label: SYMBOL_KIND_LABELS.function },
        { kind: "interface", label: SYMBOL_KIND_LABELS.interface },
        { kind: "type", label: SYMBOL_KIND_LABELS.type },
        { kind: "const", label: SYMBOL_KIND_LABELS.const },
        { kind: "let", label: SYMBOL_KIND_LABELS.let },
        { kind: "var", label: SYMBOL_KIND_LABELS.var },
    ];

    let { index }: { index: CodeIntelligenceIndexType } = $props();

    let focusedNodeId = $state<string | null>(null);
    let showFullPaths = $state(false);
    let showFiles = $state(true);
    let showSymbols = $state(true);
    let showImports = $state(true);
    let graphZoom = $state(1);
    let sigmaContainer = $state<HTMLDivElement | null>(null);
    let sigmaRenderer = $state<SigmaCodeRenderer | null>(null);
    let symbolKinds = $state<Record<KnowledgeGraphSymbolKind, boolean>>({
        class: true,
        function: true,
        interface: true,
        type: true,
        const: true,
        let: true,
        var: true,
    });

    const graph = $derived(buildKnowledgeGraph(index));
    const filteredGraph = $derived(
        filterKnowledgeGraph(graph, {
            showFiles,
            showSymbols,
            showImports,
            symbolKinds,
        }),
    );
    const filteredEdgeById = $derived(
        new Map(filteredGraph.edges.map((edge) => [edge.id, edge])),
    );
    const symbolKindCounts = $derived(readSymbolKindCounts(index.symbols));
    const focusedNode = $derived(
        filteredGraph.nodes.find((node) => node.id === focusedNodeId) ?? null,
    );
    const focusedNeighborhood = $derived.by(() => {
        if (!focusedNodeId) {
            return new Set<string>();
        }
        const nodeIds = new Set<string>([focusedNodeId]);
        for (const edge of filteredGraph.edges) {
            if (edge.from === focusedNodeId) {
                nodeIds.add(edge.to);
            }
            if (edge.to === focusedNodeId) {
                nodeIds.add(edge.from);
            }
        }
        return nodeIds;
    });
    const focusedOutgoingEdges = $derived(
        focusedNodeId
            ? filteredGraph.edges.filter((edge) => edge.from === focusedNodeId)
            : [],
    );
    const focusedIncomingEdges = $derived(
        focusedNodeId
            ? filteredGraph.edges.filter((edge) => edge.to === focusedNodeId)
            : [],
    );
    const topNode = $derived(
        [...filteredGraph.nodes].sort(
            (left, right) => right.degree - left.degree,
        )[0] ?? null,
    );

    $effect(() => {
        if (
            focusedNodeId &&
            !filteredGraph.nodes.some((node) => node.id === focusedNodeId)
        ) {
            focusedNodeId = null;
        }
    });

    onMount(() => {
        if (!sigmaContainer) {
            return;
        }

        let disposed = false;
        let renderer: SigmaCodeRenderer | null = null;
        let stopZoomSync: (() => void) | undefined;

        void (async () => {
            const [{ DirectedGraph }, { default: SigmaRenderer }] =
                await Promise.all([import("graphology"), import("sigma")]);

            if (disposed || !sigmaContainer) {
                return;
            }

            const rendererGraph = createSigmaGraph(
                filteredGraph,
                showFullPaths,
                DirectedGraph,
            );
            renderer = new SigmaRenderer(rendererGraph, sigmaContainer, {
                defaultNodeColor: SIGMA_MUTED_NODE_COLOR,
                defaultEdgeColor: SIGMA_MUTED_EDGE_COLOR,
                defaultEdgeType: "line",
                enableEdgeEvents: true,
                hideEdgesOnMove: false,
                hideLabelsOnMove: false,
                itemSizesReference: "positions",
                labelColor: { color: "#dce5ef" },
                labelDensity: 0.12,
                labelFont: "Figtree, system-ui, sans-serif",
                labelRenderedSizeThreshold: 7,
                labelSize: 11,
                labelWeight: "600",
                maxCameraRatio: zoomToCameraRatio(MIN_GRAPH_ZOOM),
                minCameraRatio: zoomToCameraRatio(MAX_GRAPH_ZOOM),
                nodeReducer: reduceSigmaNode,
                edgeReducer: reduceSigmaEdge,
                renderEdgeLabels: false,
                renderLabels: true,
                stagePadding: 36,
                zIndex: true,
            });
            const camera = renderer.getCamera();
            const syncZoom = (): void => {
                graphZoom = cameraRatioToZoom(camera.getState().ratio);
            };

            renderer.on("clickNode", ({ node }) => focusNode(node));
            renderer.on("clickStage", () => (focusedNodeId = null));
            camera.on("updated", syncZoom);
            stopZoomSync = () => camera.off("updated", syncZoom);
            syncZoom();
            sigmaRenderer = renderer;
        })();

        return () => {
            disposed = true;
            stopZoomSync?.();
            renderer?.kill();
            sigmaRenderer = null;
        };
    });

    $effect(() => {
        if (!sigmaRenderer) {
            return;
        }
        sigmaRenderer.setGraph(
            createSigmaGraph(
                filteredGraph,
                showFullPaths,
                sigmaRenderer.getGraph()
                    .constructor as DirectedGraphConstructor,
            ),
        );
        sigmaRenderer.refresh();
    });

    $effect(() => {
        if (!sigmaRenderer) {
            return;
        }
        focusedNodeId;
        focusedNeighborhood;
        filteredEdgeById;
        sigmaRenderer.setSetting("nodeReducer", reduceSigmaNode);
        sigmaRenderer.setSetting("edgeReducer", reduceSigmaEdge);
        sigmaRenderer.refresh();
    });

    function focusNode(nodeId: string): void {
        focusedNodeId = focusedNodeId === nodeId ? null : nodeId;
    }

    function focusTopNode(): void {
        focusedNodeId = topNode?.id ?? null;
    }

    function formatEdgeTarget(edge: KnowledgeGraphEdge): string {
        const target = filteredGraph.nodes.find((node) => node.id === edge.to);
        return target?.label ?? edge.to;
    }

    function formatEdgeSource(edge: KnowledgeGraphEdge): string {
        const source = filteredGraph.nodes.find(
            (node) => node.id === edge.from,
        );
        return source?.label ?? edge.from;
    }

    function setEntityFilter(
        entity: "files" | "symbols" | "imports",
        value: boolean | "indeterminate",
    ): void {
        if (entity === "files") {
            showFiles = value === true;
            return;
        }
        if (entity === "symbols") {
            showSymbols = value === true;
            return;
        }
        showImports = value === true;
    }

    function setSymbolKindFilter(
        kind: KnowledgeGraphSymbolKind,
        value: boolean | "indeterminate",
    ): void {
        symbolKinds = {
            ...symbolKinds,
            [kind]: value === true,
        };
    }

    function resetEntityFilters(): void {
        showFiles = true;
        showSymbols = true;
        showImports = true;
        symbolKinds = {
            class: true,
            function: true,
            interface: true,
            type: true,
            const: true,
            let: true,
            var: true,
        };
    }

    function changeGraphZoom(delta: number): void {
        const nextZoom = clampGraphZoom(graphZoom + delta);
        graphZoom = nextZoom;
        void sigmaRenderer
            ?.getCamera()
            .animate({ ratio: zoomToCameraRatio(nextZoom) }, { duration: 180 });
    }

    function resetGraphZoom(): void {
        graphZoom = 1;
        void sigmaRenderer?.getCamera().animatedReset({ duration: 180 });
    }

    function clampGraphZoom(value: number): number {
        return Math.min(MAX_GRAPH_ZOOM, Math.max(MIN_GRAPH_ZOOM, value));
    }

    function readZoomLabel(zoom: number): string {
        return `${Math.round(zoom * 100)}%`;
    }

    function zoomToCameraRatio(zoom: number): number {
        return 1 / clampGraphZoom(zoom);
    }

    function cameraRatioToZoom(ratio: number): number {
        return clampGraphZoom(1 / ratio);
    }

    function createSigmaGraph(
        input: KnowledgeGraph,
        useFullPaths: boolean,
        DirectedGraph: DirectedGraphConstructor,
    ): SigmaCodeGraph {
        const rendererGraph = new DirectedGraph<
            SigmaNodeAttributes,
            SigmaEdgeAttributes
        >();

        for (const node of input.nodes) {
            rendererGraph.addNode(node.id, {
                x: node.x,
                y: node.y,
                size: node.radius,
                label: useFullPaths ? node.path : node.label,
                color: node.color,
                baseColor: node.color,
                entityType: node.entityType,
                ...(node.symbolKind ? { symbolKind: node.symbolKind } : {}),
                ...(node.filePath ? { filePath: node.filePath } : {}),
                path: node.path,
                forceLabel:
                    useFullPaths ||
                    node.degree >= 3 ||
                    node.entityType === "symbol",
                zIndex: node.entityType === "symbol" ? 3 : 2,
            });
        }

        for (const edge of input.edges) {
            if (
                !rendererGraph.hasNode(edge.from) ||
                !rendererGraph.hasNode(edge.to)
            ) {
                continue;
            }
            rendererGraph.addDirectedEdgeWithKey(edge.id, edge.from, edge.to, {
                size:
                    edge.kind === "imports"
                        ? Math.min(4, 1 + edge.count * 0.45)
                        : 1.1,
                label: edge.kind,
                color:
                    edge.kind === "imports"
                        ? SIGMA_IMPORT_EDGE_COLOR
                        : SIGMA_DEFINITION_EDGE_COLOR,
                baseColor:
                    edge.kind === "imports"
                        ? SIGMA_IMPORT_EDGE_COLOR
                        : SIGMA_DEFINITION_EDGE_COLOR,
                type: edge.kind === "imports" ? "arrow" : "line",
                edgeKind: edge.kind,
                count: edge.count,
                zIndex: edge.kind === "imports" ? 2 : 1,
            });
        }

        return rendererGraph;
    }

    function reduceSigmaNode(
        nodeId: string,
        data: SigmaNodeAttributes,
    ): Partial<SigmaNodeAttributes> {
        const isFocused = nodeId === focusedNodeId;
        const isMuted = focusedNodeId
            ? !focusedNeighborhood.has(nodeId)
            : false;

        if (isFocused) {
            return {
                ...data,
                color: SIGMA_FOCUSED_NODE_COLOR,
                forceLabel: true,
                size: data.size * 1.45,
                zIndex: 10,
            };
        }

        if (isMuted) {
            return {
                ...data,
                color: SIGMA_MUTED_NODE_COLOR,
                forceLabel: false,
                label: "",
                size: Math.max(2, data.size * 0.72),
                zIndex: 0,
            };
        }

        return data;
    }

    function reduceSigmaEdge(
        edgeId: string,
        data: SigmaEdgeAttributes,
    ): Partial<SigmaEdgeAttributes> {
        const edge = filteredEdgeById.get(edgeId);
        const isMuted =
            edge && focusedNodeId
                ? edge.from !== focusedNodeId && edge.to !== focusedNodeId
                : false;

        if (isMuted) {
            return {
                ...data,
                color: SIGMA_MUTED_EDGE_COLOR,
                size: Math.max(0.4, data.size * 0.55),
                zIndex: 0,
            };
        }

        return data;
    }

    function buildKnowledgeGraph(
        input: CodeIntelligenceIndexType,
    ): KnowledgeGraph {
        const filesByPath = new Map(
            input.files.map((file) => [file.path, file]),
        );
        const symbolCountByPath = new Map<string, number>();
        for (const symbol of input.symbols) {
            symbolCountByPath.set(
                symbol.filePath,
                (symbolCountByPath.get(symbol.filePath) ?? 0) + 1,
            );
        }

        const rawEdges = new Map<
            string,
            { from: string; to: string; count: number }
        >();
        let unresolvedRelationCount = 0;
        for (const relation of input.relations) {
            const targetPath = resolveRelationTarget(relation, input.files);
            if (!targetPath || !filesByPath.has(targetPath)) {
                unresolvedRelationCount += 1;
                continue;
            }
            if (targetPath === relation.fromFilePath) {
                continue;
            }
            const edgeId = `${relation.fromFilePath}->${targetPath}`;
            const existing = rawEdges.get(edgeId);
            rawEdges.set(edgeId, {
                from: relation.fromFilePath,
                to: targetPath,
                count: (existing?.count ?? 0) + 1,
            });
        }

        const importCounts = new Map<string, number>();
        const importedByCounts = new Map<string, number>();
        for (const edge of rawEdges.values()) {
            importCounts.set(
                edge.from,
                (importCounts.get(edge.from) ?? 0) + edge.count,
            );
            importedByCounts.set(
                edge.to,
                (importedByCounts.get(edge.to) ?? 0) + edge.count,
            );
        }

        const groupByPath = new Map<string, string>();
        const groups = [
            ...new Set(input.files.map((file) => readFileGroup(file.path))),
        ].sort();
        const colorByGroup = new Map(
            groups.map((group, groupIndex) => [
                group,
                NODE_PALETTE[groupIndex % NODE_PALETTE.length],
            ]),
        );

        for (const file of input.files) {
            groupByPath.set(file.path, readFileGroup(file.path));
        }

        const rankedFiles = [...input.files]
            .map((file) => {
                const importCount = importCounts.get(file.path) ?? 0;
                const importedByCount = importedByCounts.get(file.path) ?? 0;
                const symbolCount = symbolCountByPath.get(file.path) ?? 0;
                return {
                    file,
                    importCount,
                    importedByCount,
                    symbolCount,
                    degree: importCount + importedByCount,
                };
            })
            .sort((left, right) => {
                const degreeDelta = right.degree - left.degree;
                if (degreeDelta !== 0) {
                    return degreeDelta;
                }
                const symbolDelta = right.symbolCount - left.symbolCount;
                if (symbolDelta !== 0) {
                    return symbolDelta;
                }
                return left.file.path.localeCompare(right.file.path);
            });

        const visiblePaths = new Set(
            rankedFiles
                .slice(0, MAX_VISIBLE_NODES)
                .map((entry) => entry.file.path),
        );
        const visibleFiles = rankedFiles
            .filter((entry) => visiblePaths.has(entry.file.path))
            .sort((left, right) => {
                const leftGroup = groupByPath.get(left.file.path) ?? "";
                const rightGroup = groupByPath.get(right.file.path) ?? "";
                return (
                    leftGroup.localeCompare(rightGroup) ||
                    left.file.path.localeCompare(right.file.path)
                );
            });

        const visibleEdges = [...rawEdges.values()].filter(
            (edge) => visiblePaths.has(edge.from) && visiblePaths.has(edge.to),
        );
        const fileNodes = layoutNodes(
            visibleFiles.map((entry) => {
                const group = groupByPath.get(entry.file.path) ?? "root";
                return {
                    id: entry.file.path,
                    path: entry.file.path,
                    label: readFileLabel(entry.file.path),
                    entityType: "file",
                    group,
                    color: colorByGroup.get(group) ?? NODE_PALETTE[0],
                    x: 0,
                    y: 0,
                    radius:
                        7 +
                        Math.min(
                            13,
                            Math.sqrt(entry.degree + entry.symbolCount) * 2.2,
                        ),
                    importCount: entry.importCount,
                    importedByCount: entry.importedByCount,
                    symbolCount: entry.symbolCount,
                    degree: entry.degree,
                    hidden: false,
                };
            }),
        );
        const fileNodeByPath = new Map(
            fileNodes.map((node) => [node.path, node]),
        );
        const visibleSymbols = input.symbols
            .filter((symbol) => visiblePaths.has(symbol.filePath))
            .sort(
                (left, right) =>
                    left.filePath.localeCompare(right.filePath) ||
                    left.startLine - right.startLine,
            )
            .slice(0, MAX_VISIBLE_SYMBOLS);
        const symbolsByFilePath = new Map<
            string,
            CodeIntelligenceSymbolType[]
        >();
        for (const symbol of visibleSymbols) {
            symbolsByFilePath.set(symbol.filePath, [
                ...(symbolsByFilePath.get(symbol.filePath) ?? []),
                symbol,
            ]);
        }
        const symbolIndexByFilePath = new Map<string, number>();
        const symbolNodes = visibleSymbols
            .map((symbol): KnowledgeGraphNode | undefined => {
                const parent = fileNodeByPath.get(symbol.filePath);
                if (!parent) {
                    return undefined;
                }
                const symbolIndex =
                    symbolIndexByFilePath.get(symbol.filePath) ?? 0;
                symbolIndexByFilePath.set(symbol.filePath, symbolIndex + 1);
                const siblingCount =
                    symbolsByFilePath.get(symbol.filePath)?.length ?? 1;
                const angle =
                    (Math.PI * 2 * symbolIndex) / Math.min(siblingCount, 12) +
                    Math.PI / 10;
                const distance =
                    parent.radius + 34 + Math.floor(symbolIndex / 12) * 18;
                return {
                    id: symbolNodeId(symbol),
                    path: `${symbol.filePath}#${symbol.name}`,
                    label: symbol.name,
                    entityType: "symbol",
                    symbolKind: symbol.kind,
                    filePath: symbol.filePath,
                    group: parent.group,
                    color: SYMBOL_KIND_PALETTE[symbol.kind],
                    x: parent.x + Math.cos(angle) * distance,
                    y: parent.y + Math.sin(angle) * distance,
                    radius:
                        5 + Math.min(4, Math.max(0, symbol.name.length / 18)),
                    importCount: 0,
                    importedByCount: 0,
                    symbolCount: 0,
                    degree: 1,
                    hidden: false,
                };
            })
            .filter((node): node is KnowledgeGraphNode => Boolean(node));
        const nodes = [...fileNodes, ...symbolNodes];
        const nodeById = new Map(nodes.map((node) => [node.id, node]));
        const importEdges = visibleEdges
            .map((edge): KnowledgeGraphEdge | undefined => {
                const from = nodeById.get(edge.from);
                const to = nodeById.get(edge.to);
                if (!from || !to) {
                    return undefined;
                }
                return {
                    id: `${edge.from}->${edge.to}`,
                    kind: "imports",
                    from: edge.from,
                    to: edge.to,
                    count: edge.count,
                };
            })
            .filter((edge): edge is KnowledgeGraphEdge => Boolean(edge));
        const definitionEdges = visibleSymbols
            .map((symbol): KnowledgeGraphEdge | undefined => {
                const from = nodeById.get(symbol.filePath);
                const to = nodeById.get(symbolNodeId(symbol));
                if (!from || !to) {
                    return undefined;
                }
                return {
                    id: `${symbol.filePath}->${symbolNodeId(symbol)}`,
                    kind: "defines",
                    from: symbol.filePath,
                    to: symbolNodeId(symbol),
                    count: 1,
                };
            })
            .filter((edge): edge is KnowledgeGraphEdge => Boolean(edge));
        const edges = [...importEdges, ...definitionEdges];

        return {
            nodes,
            edges,
            visibleFileCount: fileNodes.length,
            visibleSymbolCount: symbolNodes.length,
            hiddenFileCount: Math.max(0, input.files.length - fileNodes.length),
            resolvedRelationCount: [...rawEdges.values()].reduce(
                (total, edge) => total + edge.count,
                0,
            ),
            unresolvedRelationCount,
            importEdgeCount: importEdges.length,
            definitionEdgeCount: definitionEdges.length,
        };
    }

    function filterKnowledgeGraph(
        input: KnowledgeGraph,
        filters: KnowledgeGraphFilters,
    ): KnowledgeGraph {
        const nodes = input.nodes.filter((node) => {
            if (node.entityType === "file") {
                return filters.showFiles;
            }
            return (
                filters.showSymbols &&
                Boolean(filters.symbolKinds[node.symbolKind ?? "function"])
            );
        });
        const nodeIds = new Set(nodes.map((node) => node.id));
        const edges = input.edges.filter((edge) => {
            if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
                return false;
            }
            return edge.kind === "imports" ? filters.showImports : true;
        });

        return {
            ...input,
            nodes,
            edges,
            visibleFileCount: nodes.filter((node) => node.entityType === "file")
                .length,
            visibleSymbolCount: nodes.filter(
                (node) => node.entityType === "symbol",
            ).length,
            importEdgeCount: edges.filter((edge) => edge.kind === "imports")
                .length,
            definitionEdgeCount: edges.filter((edge) => edge.kind === "defines")
                .length,
        };
    }

    function readSymbolKindCounts(
        symbols: CodeIntelligenceSymbolType[],
    ): Record<KnowledgeGraphSymbolKind, number> {
        const counts: Record<KnowledgeGraphSymbolKind, number> = {
            class: 0,
            function: 0,
            interface: 0,
            type: 0,
            const: 0,
            let: 0,
            var: 0,
        };
        for (const symbol of symbols) {
            counts[symbol.kind] += 1;
        }
        return counts;
    }

    function layoutNodes(nodes: KnowledgeGraphNode[]): KnowledgeGraphNode[] {
        if (nodes.length === 0) {
            return nodes;
        }

        const centerX = GRAPH_WIDTH / 2;
        const centerY = GRAPH_HEIGHT / 2;
        const radius = Math.min(280, Math.max(145, nodes.length * 4.4));
        const groupOffsets = new Map<string, number>();
        const groups = [...new Set(nodes.map((node) => node.group))];
        for (const [index, group] of groups.entries()) {
            groupOffsets.set(
                group,
                (Math.PI * 2 * index) / Math.max(groups.length, 1),
            );
        }

        return nodes.map((node, index) => {
            const groupOffset = groupOffsets.get(node.group) ?? 0;
            const angle = groupOffset + (Math.PI * 2 * index) / nodes.length;
            const innerPull =
                node.degree === 0
                    ? 1.18
                    : Math.max(0.55, 1 - node.degree * 0.035);
            const ringNoise = ((index % 7) - 3) * 9;
            return {
                ...node,
                x: centerX + Math.cos(angle) * (radius * innerPull + ringNoise),
                y: centerY + Math.sin(angle) * (radius * innerPull + ringNoise),
            };
        });
    }

    function resolveRelationTarget(
        relation: CodeIntelligenceRelationType,
        files: CodeIntelligenceFileType[],
    ): string | undefined {
        const filePaths = new Set(files.map((file) => file.path));
        for (const candidate of createRelationCandidates(relation)) {
            for (const expanded of expandPathCandidates(candidate)) {
                if (filePaths.has(expanded)) {
                    return expanded;
                }
            }
        }
        return undefined;
    }

    function createRelationCandidates(
        relation: CodeIntelligenceRelationType,
    ): string[] {
        const target = relation.target.trim();
        const fromDirectory = relation.fromFilePath
            .split("/")
            .slice(0, -1)
            .join("/");

        if (target.startsWith(".")) {
            return [normalizePath(`${fromDirectory}/${target}`)];
        }
        if (target.startsWith("/")) {
            return [normalizePath(target.slice(1))];
        }
        if (target.startsWith("$lib/")) {
            const suffix = target.slice("$lib/".length);
            return [
                normalizePath(`apps/airport/web/src/lib/${suffix}`),
                normalizePath(`src/lib/${suffix}`),
            ];
        }
        if (target.startsWith("$docs/")) {
            return [normalizePath(`docs/${target.slice("$docs/".length)}`)];
        }
        if (target.startsWith("@flying-pillow/mission-core/")) {
            return [
                normalizePath(
                    `packages/core/src/${target.slice("@flying-pillow/mission-core/".length)}`,
                ),
            ];
        }
        if (target === "@flying-pillow/mission-core") {
            return ["packages/core/src/index"];
        }
        if (target.startsWith("@flying-pillow/mission/")) {
            return [
                normalizePath(
                    `packages/mission/src/${target.slice("@flying-pillow/mission/".length)}`,
                ),
            ];
        }
        return [target];
    }

    function expandPathCandidates(candidate: string): string[] {
        const normalized = normalizePath(candidate);
        const candidates = [normalized];
        const extensionless = normalized.replace(/\.js$/u, "");
        if (extensionless !== normalized) {
            candidates.push(extensionless);
        }
        for (const base of [...candidates]) {
            candidates.push(
                `${base}.ts`,
                `${base}.tsx`,
                `${base}.js`,
                `${base}.jsx`,
                `${base}.svelte`,
                `${base}.json`,
                `${base}/index.ts`,
                `${base}/index.tsx`,
                `${base}/index.js`,
                `${base}/index.svelte`,
            );
        }
        return [...new Set(candidates)];
    }

    function normalizePath(value: string): string {
        const output: string[] = [];
        for (const segment of value.split("/")) {
            if (!segment || segment === ".") {
                continue;
            }
            if (segment === "..") {
                output.pop();
                continue;
            }
            output.push(segment);
        }
        return output.join("/");
    }

    function readFileGroup(filePath: string): string {
        const segments = filePath.split("/");
        if (segments[0] === "apps" && segments.length >= 3) {
            return segments.slice(0, 3).join("/");
        }
        if (segments[0] === "packages" && segments.length >= 2) {
            return segments.slice(0, 2).join("/");
        }
        return segments[0] ?? "root";
    }

    function readFileLabel(filePath: string): string {
        return filePath.split("/").at(-1) ?? filePath;
    }

    function symbolNodeId(symbol: CodeIntelligenceSymbolType): string {
        return `symbol:${symbol.id}`;
    }
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden">
    <div class="flex items-center justify-between gap-3 border-b px-3 py-2">
        <div class="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant="secondary" class="gap-1.5">
                <Icon icon="lucide:git-fork" class="size-3.5" />
                {filteredGraph.visibleFileCount} files
            </Badge>
            <Badge variant="outline" class="gap-1.5">
                <Icon icon="lucide:braces" class="size-3.5" />
                {filteredGraph.visibleSymbolCount} symbols
            </Badge>
            <Badge variant="outline" class="gap-1.5">
                <Icon icon="lucide:arrow-right-left" class="size-3.5" />
                {filteredGraph.importEdgeCount} imports
            </Badge>
            {#if graph.hiddenFileCount > 0}
                <span class="text-xs text-muted-foreground">
                    {graph.hiddenFileCount} hidden
                </span>
            {/if}
        </div>
        <div class="flex shrink-0 items-center gap-1">
            <Button
                variant="ghost"
                size="icon-sm"
                title="Focus busiest file"
                aria-label="Focus busiest file"
                disabled={!topNode}
                onclick={focusTopNode}
            >
                <Icon icon="lucide:scan-search" class="size-4" />
            </Button>
            <Button
                variant="ghost"
                size="icon-sm"
                title="Zoom out"
                aria-label="Zoom out"
                disabled={graphZoom <= MIN_GRAPH_ZOOM}
                onclick={() => changeGraphZoom(-GRAPH_ZOOM_STEP)}
            >
                <Icon icon="lucide:zoom-out" class="size-4" />
            </Button>
            <Button
                variant="ghost"
                size="icon-sm"
                title={`Reset zoom (${readZoomLabel(graphZoom)})`}
                aria-label="Reset graph zoom"
                onclick={resetGraphZoom}
            >
                <span class="text-[0.65rem] font-semibold tabular-nums">
                    {readZoomLabel(graphZoom)}
                </span>
            </Button>
            <Button
                variant="ghost"
                size="icon-sm"
                title="Zoom in"
                aria-label="Zoom in"
                disabled={graphZoom >= MAX_GRAPH_ZOOM}
                onclick={() => changeGraphZoom(GRAPH_ZOOM_STEP)}
            >
                <Icon icon="lucide:zoom-in" class="size-4" />
            </Button>
            <Button
                variant={showFullPaths ? "secondary" : "ghost"}
                size="icon-sm"
                title="Toggle full path labels"
                aria-label="Toggle full path labels"
                onclick={() => (showFullPaths = !showFullPaths)}
            >
                <Icon icon="lucide:tags" class="size-4" />
            </Button>
            <Button
                variant="ghost"
                size="icon-sm"
                title="Clear graph focus"
                aria-label="Clear graph focus"
                disabled={!focusedNodeId}
                onclick={() => (focusedNodeId = null)}
            >
                <Icon icon="lucide:x" class="size-4" />
            </Button>
        </div>
    </div>

    {#if graph.nodes.length === 0}
        <div class="px-4 py-6 text-sm leading-6 text-muted-foreground">
            No resolved code relationships are available in this index.
        </div>
    {:else}
        <div class="flex min-h-0 flex-1 overflow-hidden">
            <aside
                class="flex w-40 shrink-0 flex-col gap-3 border-r bg-card/70 px-3 py-3"
            >
                <div class="flex items-center justify-between gap-2">
                    <p class="text-xs font-semibold text-foreground">
                        Selection
                    </p>
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        title="Reset graph filters"
                        aria-label="Reset graph filters"
                        onclick={resetEntityFilters}
                    >
                        <Icon icon="lucide:rotate-ccw" class="size-3.5" />
                    </Button>
                </div>

                <div class="space-y-2 text-xs">
                    <label
                        class="flex items-center gap-2 text-muted-foreground"
                    >
                        <Checkbox
                            checked={showFiles}
                            onCheckedChange={(value) =>
                                setEntityFilter("files", value)}
                            aria-label="Filter file entities"
                        />
                        <span class="min-w-0 flex-1 truncate">Files</span>
                        <span class="tabular-nums"
                            >{graph.visibleFileCount}</span
                        >
                    </label>
                    <label
                        class="flex items-center gap-2 text-muted-foreground"
                    >
                        <Checkbox
                            checked={showSymbols}
                            onCheckedChange={(value) =>
                                setEntityFilter("symbols", value)}
                            aria-label="Filter symbol entities"
                        />
                        <span class="min-w-0 flex-1 truncate">Symbols</span>
                        <span class="tabular-nums"
                            >{graph.visibleSymbolCount}</span
                        >
                    </label>
                    <label
                        class="flex items-center gap-2 text-muted-foreground"
                    >
                        <Checkbox
                            checked={showImports}
                            onCheckedChange={(value) =>
                                setEntityFilter("imports", value)}
                            aria-label="Filter import relationships"
                        />
                        <span class="min-w-0 flex-1 truncate">Imports</span>
                        <span class="tabular-nums">{graph.importEdgeCount}</span
                        >
                    </label>
                </div>

                <div class="border-t pt-3">
                    <p class="mb-2 text-xs font-medium text-foreground">
                        Symbol Kind
                    </p>
                    <div class="space-y-2 text-xs">
                        {#each SYMBOL_KIND_OPTIONS as option (option.kind)}
                            <label
                                class={[
                                    "flex items-center gap-2 text-muted-foreground",
                                    (!showSymbols ||
                                        symbolKindCounts[option.kind] === 0) &&
                                        "opacity-50",
                                ]}
                            >
                                <Checkbox
                                    checked={symbolKinds[option.kind]}
                                    disabled={!showSymbols ||
                                        symbolKindCounts[option.kind] === 0}
                                    onCheckedChange={(value) =>
                                        setSymbolKindFilter(option.kind, value)}
                                    aria-label={`Filter ${option.label}`}
                                />
                                <span class="min-w-0 flex-1 truncate"
                                    >{option.label}</span
                                >
                                <span class="tabular-nums"
                                    >{symbolKindCounts[option.kind]}</span
                                >
                            </label>
                        {/each}
                    </div>
                </div>
            </aside>

            <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                {#if filteredGraph.nodes.length === 0}
                    <div
                        class="px-4 py-6 text-sm leading-6 text-muted-foreground"
                    >
                        No graph entities match the active selection.
                    </div>
                {:else}
                    <div
                        class="relative min-h-0 flex-1 overflow-hidden bg-[radial-gradient(circle_at_24px_24px,oklch(0.72_0.02_255_/_0.16)_1px,transparent_1px)] [background-size:32px_32px]"
                    >
                        <div
                            bind:this={sigmaContainer}
                            class="absolute inset-0 bg-[linear-gradient(180deg,oklch(0.18_0.015_255_/_0.92),oklch(0.14_0.012_255_/_0.96))]"
                            role="img"
                            aria-label="Code intelligence knowledge graph"
                        ></div>
                        <div
                            class="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,oklch(0.18_0.015_255_/_0.34),transparent)]"
                        ></div>
                    </div>

                    <div class="border-t bg-card px-3 py-2">
                        {#if focusedNode}
                            <div class="min-w-0 space-y-2">
                                <div
                                    class="flex items-start justify-between gap-3"
                                >
                                    <div class="min-w-0">
                                        <p
                                            class="truncate text-xs font-medium text-foreground"
                                        >
                                            {focusedNode.path}
                                        </p>
                                        <p
                                            class="mt-0.5 text-xs text-muted-foreground"
                                        >
                                            {#if focusedNode.entityType === "symbol"}
                                                {focusedNode.symbolKind} in {focusedNode.filePath}
                                            {:else}
                                                {focusedNode.symbolCount} symbols,
                                                {focusedNode.importCount} imports,
                                                {focusedNode.importedByCount} incoming
                                            {/if}
                                        </p>
                                    </div>
                                    <Badge variant="outline" class="shrink-0">
                                        {focusedNode.entityType === "symbol"
                                            ? "symbol"
                                            : focusedNode.group}
                                    </Badge>
                                </div>
                                <div
                                    class="grid grid-cols-2 gap-2 text-xs text-muted-foreground"
                                >
                                    <div class="min-w-0">
                                        <p class="font-medium text-foreground">
                                            Outgoing
                                        </p>
                                        <p class="mt-1 truncate">
                                            {focusedOutgoingEdges.length > 0
                                                ? focusedOutgoingEdges
                                                      .map(formatEdgeTarget)
                                                      .join(", ")
                                                : "None resolved"}
                                        </p>
                                    </div>
                                    <div class="min-w-0">
                                        <p class="font-medium text-foreground">
                                            Incoming
                                        </p>
                                        <p class="mt-1 truncate">
                                            {focusedIncomingEdges.length > 0
                                                ? focusedIncomingEdges
                                                      .map(formatEdgeSource)
                                                      .join(", ")
                                                : "None resolved"}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        {:else}
                            <div
                                class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
                            >
                                <span
                                    >{graph.resolvedRelationCount} resolved imports</span
                                >
                                <span
                                    >{graph.unresolvedRelationCount} external or
                                    unresolved imports</span
                                >
                                <span
                                    >{filteredGraph.definitionEdgeCount} symbol links</span
                                >
                                {#if topNode}
                                    <span class="truncate"
                                        >Highest degree: {topNode.label}</span
                                    >
                                {/if}
                            </div>
                        {/if}
                    </div>
                {/if}
            </div>
        </div>
    {/if}
</div>
