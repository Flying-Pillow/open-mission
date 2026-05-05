<script lang="ts">
    import { browser } from "$app/environment";
    import Icon from "@iconify/svelte";
    import type { Artifact } from "./Artifact.svelte.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import {
        isArtifactTextEditable,
        resolveMonacoLanguage,
    } from "./ArtifactPresentation.js";

    const MONACO_VERSION = "0.52.2";
    const MONACO_BASE_URL = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs`;

    type MonacoEditorInstance = {
        getValue(): string;
        setValue(value: string): void;
        updateOptions(options: Record<string, unknown>): void;
        onDidChangeModelContent(listener: () => void): { dispose(): void };
        getModel(): MonacoModel | null;
        setModel(model: MonacoModel | null): void;
        layout(): void;
        dispose(): void;
    };

    type MonacoModel = {
        getValue(): string;
        getLanguageId(): string;
        dispose(): void;
    };

    type MonacoNamespace = {
        editor: {
            create(
                element: HTMLElement,
                options: Record<string, unknown>,
            ): MonacoEditorInstance;
            createModel(value: string, language?: string): MonacoModel;
            setTheme(theme: string): void;
        };
    };

    type MonacoLoaderWindow = Window & {
        MonacoEnvironment?: {
            getWorkerUrl?: (moduleId: string, label: string) => string;
        };
        require?: {
            config(config: { paths: Record<string, string> }): void;
            modules?: Record<string, boolean>;
            (dependencies: string[], callback: () => void): void;
        };
        monaco?: MonacoNamespace;
    };

    let monacoLoaderPromise: Promise<MonacoNamespace> | null = null;

    let {
        artifact,
        onCloseRequested,
    }: {
        artifact?: Artifact;
        onCloseRequested: () => void;
    } = $props();

    let content = $state("");
    let originalContent = $state("");
    let saveInFlight = $state(false);
    let saveStatus = $state<"idle" | "saving" | "saved">("idle");
    let saveError = $state<string | null>(null);
    let lastSavedAt = $state<string | null>(null);
    let loadedId = $state<string | null>(null);
    let monacoContainer = $state<HTMLElement | null>(null);
    let editor = $state<MonacoEditorInstance | null>(null);
    let editorSubscription = $state<{ dispose(): void } | null>(null);
    let editorModel = $state<MonacoModel | null>(null);
    let editorLanguage = $state<string | null>(null);
    let monacoReady = $state(false);
    let monacoLoadError = $state<string | null>(null);
    const id = $derived(artifact?.id);
    const artifactBodyLocation = $derived(artifact?.bodyLocationLabel);
    const artifactBodyStatus = $derived(artifact?.bodyStatus ?? "idle");
    const artifactBodyText = $derived(artifact?.bodyText);
    const artifactBodyError = $derived(artifact?.bodyError);
    const loading = $derived(artifact?.isBodyLoading ?? false);
    const isEditableTextArtifact = $derived(
        isArtifactTextEditable(artifactBodyLocation),
    );
    const panelLabel = $derived(artifact?.label ?? "");
    const hasUnsavedChanges = $derived(
        id === loadedId && content !== originalContent,
    );
    const statusMessage = $derived.by(() => {
        if (loading) {
            return "Loading artifact...";
        }
        if (saveError) {
            return saveError;
        }
        if (saveInFlight || saveStatus === "saving") {
            return "Saving changes...";
        }
        if (hasUnsavedChanges) {
            return "Unsaved changes";
        }
        if (saveStatus === "saved" && lastSavedAt) {
            return `Saved ${formatTimestamp(lastSavedAt)}`;
        }
        return "Ready to edit";
    });

    $effect(() => {
        if (!id || !isEditableTextArtifact) {
            content = "";
            originalContent = "";
            loadedId = null;
            saveStatus = "idle";
            saveError = null;
            lastSavedAt = null;
            return;
        }

        if (!artifact || artifactBodyStatus !== "idle") {
            return;
        }

        void artifact.refreshBody({ executionContext: "render" });
    });

    $effect(() => {
        if (!id || !isEditableTextArtifact) {
            return;
        }

        if (artifactBodyStatus !== "loaded") {
            return;
        }

        if (loadedId === id) {
            return;
        }

        if (artifactBodyText === undefined) {
            return;
        }

        content = artifactBodyText;
        originalContent = artifactBodyText;
        saveStatus = "idle";
        saveError = null;
        lastSavedAt = null;
        loadedId = id;
    });

    $effect(() => {
        if (!id || !isEditableTextArtifact) {
            disposeEditor();
            monacoReady = false;
            monacoLoadError = null;
            return;
        }

        if (
            !browser ||
            !monacoContainer ||
            !id ||
            !isEditableTextArtifact ||
            editor ||
            monacoLoadError
        ) {
            return;
        }

        let cancelled = false;

        void setupEditor(monacoContainer).catch((setupError) => {
            if (cancelled) {
                return;
            }

            monacoLoadError =
                setupError instanceof Error
                    ? setupError.message
                    : String(setupError);
        });

        return () => {
            cancelled = true;
        };
    });

    $effect(() => {
        if (!editor) {
            return;
        }

        const nextLanguage = resolveMonacoLanguage(artifactBodyLocation);
        if (editorModel && editorLanguage !== nextLanguage) {
            const replacementModel = (
                window as unknown as MonacoLoaderWindow
            ).monaco?.editor.createModel(content, nextLanguage);

            if (replacementModel) {
                editor.setModel(replacementModel);
                editorModel.dispose();
                editorModel = replacementModel;
                editorLanguage = nextLanguage;
            }
        }

        const nextValue = content;
        if (editor.getValue() !== nextValue) {
            editor.setValue(nextValue);
        }

        const model = editor.getModel();
        if (model && editorModel !== model) {
            editorModel = model;
        }
    });

    $effect(() => {
        if (!browser || !editor) {
            return;
        }

        const theme = resolveMonacoTheme();
        const monacoWindow = window as unknown as MonacoLoaderWindow;
        monacoWindow.monaco?.editor.setTheme(theme);

        const root = document.documentElement;
        const observer = new MutationObserver(() => {
            monacoWindow.monaco?.editor.setTheme(resolveMonacoTheme());
        });
        observer.observe(root, {
            attributes: true,
            attributeFilter: ["class"],
        });

        return () => {
            observer.disconnect();
        };
    });

    $effect(() => {
        return () => {
            disposeEditor();
        };
    });

    async function saveArtifactBody(nextContent: string): Promise<void> {
        saveInFlight = true;
        saveStatus = "saving";
        saveError = null;

        try {
            if (!artifact) {
                throw new Error(
                    "Artifact saving is unavailable for the current selection.",
                );
            }

            if (!isEditableTextArtifact) {
                throw new Error("This artifact is not editable in Monaco.");
            }

            await artifact.saveBody(nextContent);

            originalContent = artifact.bodyText ?? nextContent;
            loadedId = artifact.id;
            lastSavedAt = new Date().toISOString();
            saveStatus = "saved";
        } catch (saveFailure) {
            saveError =
                saveFailure instanceof Error
                    ? saveFailure.message
                    : String(saveFailure);
            saveStatus = "idle";
        } finally {
            saveInFlight = false;
        }
    }

    async function handleSaveRequest(): Promise<void> {
        if (
            !id ||
            !isEditableTextArtifact ||
            saveInFlight ||
            !hasUnsavedChanges
        ) {
            return;
        }

        await saveArtifactBody(content);
    }

    async function handleCloseRequest(): Promise<void> {
        if (saveInFlight) {
            return;
        }

        if (hasUnsavedChanges) {
            if (!browser) {
                return;
            }

            const shouldDiscard = window.confirm(
                "Discard unsaved changes and close the editor?",
            );
            if (!shouldDiscard) {
                return;
            }
        }

        onCloseRequested();
    }

    async function setupEditor(container: HTMLElement): Promise<void> {
        const monaco = await loadMonacoFromCdn();
        const language = resolveMonacoLanguage(artifactBodyLocation);

        const model = monaco.editor.createModel(content, language);
        const instance = monaco.editor.create(container, {
            model,
            automaticLayout: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            tabSize: 2,
            wordWrap: "on",
            fontSize: 13,
            lineHeight: 22,
            glyphMargin: false,
            lineNumbersMinChars: 3,
            padding: { top: 16, bottom: 16 },
        });

        monaco.editor.setTheme(resolveMonacoTheme());

        editorSubscription = instance.onDidChangeModelContent(() => {
            content = instance.getValue();
        });
        editorModel = model;
        editorLanguage = language;
        editor = instance;
        monacoReady = true;
        monacoLoadError = null;
    }

    async function loadMonacoFromCdn(): Promise<MonacoNamespace> {
        if (!browser) {
            throw new Error("Monaco can only be loaded in the browser.");
        }

        if (!monacoLoaderPromise) {
            monacoLoaderPromise = new Promise<MonacoNamespace>(
                (resolve, reject) => {
                    const monacoWindow =
                        window as unknown as MonacoLoaderWindow;

                    ensureMonacoStylesheet();

                    const finishLoading = () => {
                        const require = monacoWindow.require;
                        if (!require) {
                            reject(
                                new Error(
                                    "Monaco loader did not initialize correctly.",
                                ),
                            );
                            return;
                        }

                        monacoWindow.MonacoEnvironment = {
                            getWorkerUrl: (
                                _moduleId: string,
                                label: string,
                            ) => {
                                return `data:text/javascript;charset=utf-8,${encodeURIComponent(
                                    `self.MonacoEnvironment={baseUrl:'${MONACO_BASE_URL}/'};importScripts('${MONACO_BASE_URL}/base/worker/workerMain.js');`,
                                )}`;
                            },
                        };

                        require.config({ paths: { vs: MONACO_BASE_URL } });
                        require(["vs/editor/editor.main"], () => {
                            if (!monacoWindow.monaco) {
                                reject(
                                    new Error(
                                        "Monaco did not finish loading from the CDN.",
                                    ),
                                );
                                return;
                            }

                            resolve(monacoWindow.monaco);
                        });
                    };

                    if (monacoWindow.monaco) {
                        resolve(monacoWindow.monaco);
                        return;
                    }

                    if (
                        monacoWindow.require?.modules?.["vs/editor/editor.main"]
                    ) {
                        finishLoading();
                        return;
                    }

                    const existingScript =
                        document.querySelector<HTMLScriptElement>(
                            'script[data-monaco-loader="true"]',
                        );

                    if (existingScript) {
                        existingScript.addEventListener("load", finishLoading, {
                            once: true,
                        });
                        existingScript.addEventListener(
                            "error",
                            () =>
                                reject(
                                    new Error(
                                        "Failed to load Monaco from the CDN.",
                                    ),
                                ),
                            { once: true },
                        );
                        return;
                    }

                    const script = document.createElement("script");
                    script.async = true;
                    script.dataset.monacoLoader = "true";
                    script.src = `${MONACO_BASE_URL}/loader.js`;
                    script.addEventListener("load", finishLoading, {
                        once: true,
                    });
                    script.addEventListener(
                        "error",
                        () =>
                            reject(
                                new Error(
                                    "Failed to load Monaco from the CDN.",
                                ),
                            ),
                        { once: true },
                    );

                    document.head.append(script);
                },
            );
        }

        return monacoLoaderPromise;
    }

    function ensureMonacoStylesheet(): void {
        if (document.querySelector('link[data-monaco-style="true"]')) {
            return;
        }

        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = `${MONACO_BASE_URL}/editor/editor.main.css`;
        link.dataset.monacoStyle = "true";
        document.head.append(link);
    }

    function disposeEditor(): void {
        editorSubscription?.dispose();
        editorSubscription = null;
        editor?.dispose();
        editor = null;
        editorModel?.dispose();
        editorModel = null;
        editorLanguage = null;
    }

    function resolveMonacoTheme(): string {
        return document.documentElement.classList.contains("dark")
            ? "vs-dark"
            : "vs";
    }

    function formatTimestamp(timestamp: string): string {
        const date = new Date(timestamp);
        if (Number.isNaN(date.getTime())) {
            return "just now";
        }

        return new Intl.DateTimeFormat(undefined, {
            hour: "numeric",
            minute: "2-digit",
            second: "2-digit",
        }).format(date);
    }
</script>

<section
    class="h-full grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-2xl border bg-card/70 px-5 py-4 backdrop-blur-sm"
>
    <header class="space-y-2 border-b pb-3">
        <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
                <h2 class="text-sm font-semibold text-foreground">
                    {panelLabel}
                </h2>
                <p class="mt-1 break-all text-xs text-muted-foreground">
                    {artifactBodyLocation ??
                        "No artifact body resolves from the current mission selection."}
                </p>
            </div>

            <div class="flex items-center gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    onclick={handleSaveRequest}
                    disabled={!hasUnsavedChanges ||
                        saveInFlight ||
                        !id ||
                        !isEditableTextArtifact}
                >
                    <Icon icon="lucide:save" />
                    Save
                </Button>

                <Button
                    variant="ghost"
                    size="icon-sm"
                    onclick={handleCloseRequest}
                >
                    <Icon icon="lucide:x" />
                    <span class="sr-only">Close editor</span>
                </Button>
            </div>
        </div>

        <div class="flex items-center gap-2 text-xs text-muted-foreground">
            <Icon icon="lucide:save" class="size-3.5" />
            <span>{statusMessage}</span>
        </div>

        {#if artifactBodyError}
            <p class="text-sm text-rose-600">{artifactBodyError}</p>
        {/if}

        {#if monacoLoadError}
            <p class="text-sm text-rose-600">{monacoLoadError}</p>
        {/if}

        {#if saveError}
            <p class="text-sm text-rose-600">{saveError}</p>
        {/if}
    </header>

    <div class="min-h-0 pt-3">
        {#if id && isEditableTextArtifact}
            {#if monacoLoadError}
                <div
                    class="flex h-full min-h-[24rem] items-center justify-center rounded-xl border bg-background/60 px-6 py-8 text-center text-sm text-rose-600"
                >
                    {monacoLoadError}
                </div>
            {:else}
                <div
                    class="relative h-full min-h-[24rem] overflow-hidden rounded-xl border bg-background/80"
                >
                    {#if !monacoReady}
                        <div
                            class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/70 px-6 py-8 text-center text-sm text-muted-foreground backdrop-blur-[1px]"
                        >
                            Loading editor...
                        </div>
                    {/if}

                    <div
                        bind:this={monacoContainer}
                        class="h-full min-h-[24rem] w-full"
                    ></div>
                </div>
            {/if}
        {:else}
            <div
                class="flex h-full min-h-[24rem] items-center justify-center rounded-xl border border-dashed bg-background/60 px-6 py-8 text-center text-sm text-muted-foreground"
            >
                No Monaco editor is available for this artifact.
            </div>
        {/if}
    </div>
</section>
