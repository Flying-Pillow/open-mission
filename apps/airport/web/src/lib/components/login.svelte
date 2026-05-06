<script lang="ts">
    import Icon from "@iconify/svelte";
    import * as Avatar from "$lib/components/ui/avatar/index.js";
    import * as Badge from "$lib/components/ui/badge/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import * as Card from "$lib/components/ui/card/index.js";

    let {
        githubStatus,
        user,
        error,
        probe,
        redirectTo = "/",
        device,
    }: {
        githubStatus: "connected" | "disconnected" | "unknown";
        user?: {
            name: string;
            email?: string;
            avatarUrl?: string;
        };
        error?: string;
        probe: {
            status: "idle" | "success" | "error";
            message: string;
        };
        redirectTo?: string;
        device: {
            available: boolean;
            error?: string;
            startHref: string;
            pollHref: string;
        };
    } = $props();

    type DeviceFlowState = {
        userCode: string;
        verificationUri: string;
        intervalSeconds: number;
        expiresAt: string;
        message: string;
    };

    const statusTone = $derived(
        githubStatus === "connected"
            ? "connected"
            : githubStatus === "disconnected"
              ? "disconnected"
              : "unknown",
    );

    const statusLabel = $derived(
        statusTone === "connected"
            ? "Connected"
            : statusTone === "disconnected"
              ? "Sign in required"
              : "CLI unavailable",
    );

    const isConnected = $derived(statusTone === "connected" && !!user);

    const userInitials = $derived.by(
        () =>
            user?.name
                ?.split(/[^A-Za-z0-9]+/u)
                .filter((segment) => segment.length > 0)
                .slice(0, 2)
                .map((segment) => segment[0]?.toUpperCase() ?? "")
                .join("") || "GH",
    );

    let deviceFlow = $state<DeviceFlowState | undefined>();
    let deviceFlowError = $state<string | undefined>();
    let deviceFlowPending = $state(false);
    let deviceFlowStarting = $state(false);
    let deviceCodeCopied = $state(false);
    let requestedDeviceCode = $state(false);

    $effect(() => {
        if (
            requestedDeviceCode ||
            isConnected ||
            !device.available ||
            deviceFlow ||
            deviceFlowStarting
        ) {
            return;
        }

        requestedDeviceCode = true;
        void beginDeviceFlow();
    });

    $effect(() => {
        if (!deviceFlow || deviceFlowPending) {
            return;
        }

        const timer = window.setTimeout(() => {
            void pollDeviceFlow();
        }, deviceFlow.intervalSeconds * 1000);

        return () => {
            window.clearTimeout(timer);
        };
    });

    async function beginDeviceFlow(): Promise<void> {
        deviceFlowStarting = true;
        deviceFlowError = undefined;
        deviceCodeCopied = false;

        try {
            const response = await fetch(device.startHref, {
                method: "POST",
                headers: {
                    accept: "application/json",
                },
            });
            const payload = await response.json();
            if (!response.ok) {
                throw new Error(
                    typeof payload?.message === "string"
                        ? payload.message
                        : "The sign-in code could not be created.",
                );
            }

            deviceFlow = {
                userCode: String(payload.userCode ?? "").trim(),
                verificationUri: String(payload.verificationUri ?? "").trim(),
                intervalSeconds: Number(payload.intervalSeconds ?? 5),
                expiresAt: String(payload.expiresAt ?? "").trim(),
                message:
                    "Open the sign-in page, enter this code, and this page will continue automatically.",
            };
        } catch (deviceError) {
            deviceFlowError =
                deviceError instanceof Error
                    ? deviceError.message
                    : String(deviceError);
            deviceFlow = undefined;
        } finally {
            deviceFlowStarting = false;
        }
    }

    async function pollDeviceFlow(): Promise<void> {
        if (!deviceFlow || deviceFlowPending) {
            return;
        }

        deviceFlowPending = true;

        try {
            const response = await fetch(device.pollHref, {
                method: "POST",
                headers: {
                    accept: "application/json",
                },
            });
            const payload = await response.json();

            if (payload?.status === "authorized") {
                window.location.assign(
                    String(payload.redirectTo ?? redirectTo),
                );
                return;
            }

            if (payload?.status === "pending" && deviceFlow) {
                deviceFlow = {
                    ...deviceFlow,
                    intervalSeconds: Number(payload.intervalSeconds ?? 5),
                    expiresAt: String(
                        payload.expiresAt ?? deviceFlow.expiresAt,
                    ),
                    message: "Waiting for you to finish signing in...",
                };
                return;
            }

            throw new Error(
                typeof payload?.message === "string"
                    ? payload.message
                    : "Sign-in could not be completed.",
            );
        } catch (deviceError) {
            deviceFlowError =
                deviceError instanceof Error
                    ? deviceError.message
                    : String(deviceError);
            deviceFlow = undefined;
        } finally {
            deviceFlowPending = false;
        }
    }

    async function copyDeviceCode(): Promise<void> {
        if (!deviceFlow?.userCode) {
            return;
        }

        await navigator.clipboard.writeText(deviceFlow.userCode);
        deviceCodeCopied = true;
    }
</script>

<section class="grid w-full gap-6 lg:grid-cols-[1.1fr_0.9fr]">
    <Card.Root class="border-border/60 bg-card/85 backdrop-blur-xl">
        <Card.Header class="space-y-5 px-8 pb-0 pt-8">
            <div class="flex items-center justify-between gap-3">
                <Badge.Badge
                    variant="outline"
                    class="rounded-full px-3 py-1 text-xs font-medium"
                >
                    <Icon icon="lucide:github" class="size-3.5" />
                    GitHub only
                </Badge.Badge>
                <Badge.Badge
                    variant="outline"
                    class="rounded-full px-3 py-1 text-xs font-medium"
                >
                    {statusLabel}
                </Badge.Badge>
            </div>

            <div class="space-y-3">
                <Card.Title
                    class="text-3xl font-semibold tracking-tight sm:text-4xl"
                >
                    Sign in to Mission with GitHub
                </Card.Title>
                <Card.Description
                    class="max-w-xl text-base leading-7 text-muted-foreground"
                >
                    Sign in with your GitHub account to continue in Mission. We
                    will show a short code for you to enter, then bring you back
                    here automatically.
                </Card.Description>
            </div>
        </Card.Header>

        <Card.Content class="grid gap-6 px-8 pb-8 pt-6">
            <div class="grid gap-4 sm:grid-cols-3">
                <div class="rounded-2xl border bg-background/70 p-4">
                    <Icon
                        icon="lucide:shield-check"
                        class="mb-3 size-5 text-primary"
                    />
                    <p class="font-medium">Safe sign-in</p>
                    <p class="mt-1 text-sm text-muted-foreground">
                        GitHub handles the sign-in, and Mission keeps you signed
                        in here after approval.
                    </p>
                </div>
                <div class="rounded-2xl border bg-background/70 p-4">
                    <Icon
                        icon="lucide:github"
                        class="mb-3 size-5 text-primary"
                    />
                    <p class="font-medium">Your account</p>
                    <p class="mt-1 text-sm text-muted-foreground">
                        After sign-in, Mission shows which GitHub account you
                        connected before you continue.
                    </p>
                </div>
                <div class="rounded-2xl border bg-background/70 p-4">
                    <Icon
                        icon="lucide:sparkles"
                        class="mb-3 size-5 text-primary"
                    />
                    <p class="font-medium">Easy to change</p>
                    <p class="mt-1 text-sm text-muted-foreground">
                        You can sign out at any time and connect a different
                        account later if needed.
                    </p>
                </div>
            </div>

            <div class="rounded-2xl border bg-muted/40 p-5">
                <p class="text-sm font-medium">Before you continue</p>
                <ul class="mt-3 space-y-2 text-sm text-muted-foreground">
                    <li class="flex items-start gap-2">
                        <Icon
                            icon="lucide:check"
                            class="mt-0.5 size-4 text-primary"
                        />A sign-in code will appear automatically on this page.
                    </li>
                    <li class="flex items-start gap-2">
                        <Icon
                            icon="lucide:check"
                            class="mt-0.5 size-4 text-primary"
                        />Open the sign-in page and enter that code.
                    </li>
                    <li class="flex items-start gap-2">
                        <Icon
                            icon="lucide:check"
                            class="mt-0.5 size-4 text-primary"
                        />Once you finish, Mission continues here automatically.
                    </li>
                </ul>
            </div>
        </Card.Content>
    </Card.Root>

    <Card.Root class="border-border/70 bg-card/95 backdrop-blur-xl">
        {#if isConnected && user}
            <Card.Header class="px-8 pb-0 pt-8">
                <Card.Title
                    class="flex items-center gap-3 text-2xl font-semibold"
                >
                    <Icon icon="lucide:github" class="size-6" />
                    Signed in with GitHub
                </Card.Title>
                <Card.Description class="pt-1 text-sm leading-6">
                    Mission will use this GitHub account for authenticated
                    repository actions in this browser execution.
                </Card.Description>
            </Card.Header>

            <Card.Content class="space-y-6 px-8 pt-6">
                <div class="rounded-3xl border bg-background/80 p-6">
                    <div class="flex flex-col items-center text-center">
                        <Avatar.Root
                            class="h-48 w-48 max-w-none overflow-hidden rounded-[2.5rem] shadow-sm"
                        >
                            <Avatar.Image
                                src={user.avatarUrl}
                                alt={user.name}
                            />
                            <Avatar.Fallback class="rounded-[2.5rem] text-6xl">
                                {userInitials}
                            </Avatar.Fallback>
                        </Avatar.Root>
                        <div class="mt-5 space-y-2">
                            <p class="text-sm text-muted-foreground">
                                Signed in as
                            </p>
                            <p class="text-2xl font-semibold tracking-tight">
                                {user.name}
                            </p>
                        </div>
                        {#if user.email}
                            <div
                                class="mt-5 inline-flex items-center gap-2 rounded-full border bg-muted/40 px-4 py-2 text-sm text-muted-foreground"
                            >
                                <Icon icon="lucide:mail" class="size-4" />
                                {user.email}
                            </div>
                        {/if}
                    </div>
                </div>

                <div class="rounded-2xl border bg-background/70 p-4">
                    <p
                        class:text-muted-foreground={probe.status === "idle"}
                        class:text-emerald-600={probe.status === "success"}
                        class:text-destructive={probe.status === "error"}
                        class="text-sm"
                    >
                        {probe.message}
                    </p>
                </div>

                <div class="space-y-3">
                    <Button
                        href={redirectTo}
                        size="lg"
                        class="w-full rounded-2xl"
                    >
                        Continue to Mission
                        <Icon icon="lucide:arrow-right" class="size-4" />
                    </Button>

                    <form
                        method="POST"
                        action="?/clearGithubToken"
                        class="w-full"
                    >
                        <input
                            type="hidden"
                            name="redirect_to"
                            value={redirectTo}
                        />
                        <Button
                            type="submit"
                            variant="outline"
                            size="lg"
                            class="w-full rounded-2xl"
                        >
                            Sign out
                        </Button>
                    </form>
                </div>
            </Card.Content>
        {:else}
            <Card.Header class="px-8 pb-0 pt-8">
                <Card.Title
                    class="flex items-center gap-3 text-2xl font-semibold"
                >
                    <Icon icon="lucide:github" class="size-6" />
                    Sign in with GitHub
                </Card.Title>
                <Card.Description class="pt-1 text-sm leading-6">
                    Your sign-in code appears below automatically. Enter it on
                    the GitHub sign-in page to continue.
                </Card.Description>
            </Card.Header>

            <Card.Content class="space-y-5 px-8 pt-6">
                {#if error || deviceFlowError}
                    <div
                        class="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                    >
                        {error || deviceFlowError}
                    </div>
                {/if}

                <div
                    class="rounded-2xl border bg-background/70 p-4 text-sm text-muted-foreground"
                >
                    Use the code below to sign in with GitHub. When you finish,
                    this page will continue on its own.
                </div>

                <div class="space-y-3">
                    {#if device.available}
                        {#if deviceFlowStarting && !deviceFlow}
                            <div
                                class="rounded-2xl border bg-background/70 p-4 text-sm text-muted-foreground"
                            >
                                Preparing your sign-in code...
                            </div>
                        {/if}
                    {:else if device.error}
                        <div
                            class="rounded-2xl border bg-background/70 p-4 text-sm text-muted-foreground"
                        >
                            {device.error}
                        </div>
                    {/if}

                    <form
                        method="POST"
                        action="?/clearGithubToken"
                        class="w-full"
                    >
                        <input
                            type="hidden"
                            name="redirect_to"
                            value={redirectTo}
                        />
                        <Button
                            type="submit"
                            variant="outline"
                            size="lg"
                            class="w-full rounded-2xl"
                        >
                            Clear sign-in state
                        </Button>
                    </form>
                </div>

                {#if deviceFlow}
                    <div class="rounded-2xl border bg-background/70 p-4">
                        <div class="flex items-center justify-between gap-3">
                            <div>
                                <p class="text-sm font-medium">
                                    Your sign-in code
                                </p>
                                <p class="mt-1 text-sm text-muted-foreground">
                                    {deviceFlow.message}
                                </p>
                            </div>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onclick={() => {
                                    void copyDeviceCode();
                                }}
                            >
                                <Icon icon="lucide:copy" class="size-4" />
                                {deviceCodeCopied ? "Copied" : "Copy code"}
                            </Button>
                        </div>

                        <div
                            class="mt-4 rounded-xl border border-dashed bg-muted/30 px-4 py-3 text-center text-2xl font-semibold tracking-[0.18em]"
                        >
                            {deviceFlow.userCode}
                        </div>

                        <div class="mt-4 flex flex-col gap-3 sm:flex-row">
                            <Button
                                href={deviceFlow.verificationUri}
                                target="_blank"
                                rel="noreferrer"
                                class="w-full rounded-2xl"
                            >
                                Open sign-in page
                                <Icon
                                    icon="lucide:arrow-right"
                                    class="size-4"
                                />
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                class="w-full rounded-2xl"
                                onclick={() => {
                                    void pollDeviceFlow();
                                }}
                                disabled={deviceFlowPending}
                            >
                                {deviceFlowPending
                                    ? "Checking sign-in..."
                                    : "I entered the code"}
                            </Button>
                        </div>

                        <p class="mt-3 text-xs text-muted-foreground">
                            Expires at {new Date(
                                deviceFlow.expiresAt,
                            ).toLocaleTimeString()}.
                        </p>
                    </div>
                {/if}

                <div class="rounded-2xl border bg-background/70 p-4">
                    <p class="text-sm font-medium">Current status</p>
                    <p
                        class:text-muted-foreground={probe.status === "idle"}
                        class:text-emerald-600={probe.status === "success"}
                        class:text-destructive={probe.status === "error"}
                        class="mt-2 text-sm"
                    >
                        {probe.message}
                    </p>
                </div>
            </Card.Content>
        {/if}
    </Card.Root>
</section>
