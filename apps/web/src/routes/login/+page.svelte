<!-- /apps/web/src/routes/login/+page.svelte: GitHub login surface for Open Mission web auth. -->
<script lang="ts">
    import Login from "$lib/components/login.svelte";

    let { data } = $props<{
        data: {
            appContext: {
                githubStatus: "connected" | "disconnected" | "unknown";
                user?: {
                    name: string;
                    email?: string;
                    avatarUrl?: string;
                };
            };
            redirectTo: string;
            githubProbe: {
                status: "idle" | "success" | "error";
                message: string;
            };
            error?: string;
            device: {
                available: boolean;
                error?: string;
                startHref: string;
                pollHref: string;
            };
        };
    }>();
</script>

<svelte:head>
    <title>Login · Flying-Pillow Open Mission</title>
    <meta name="description" content="Sign in to Mission with GitHub." />
</svelte:head>

<div class="relative min-h-screen overflow-hidden bg-background">
    <div
        class="absolute inset-0 bg-[radial-gradient(circle_at_top,_hsl(var(--primary)/0.16),_transparent_38%),radial-gradient(circle_at_bottom_right,_hsl(var(--accent)/0.18),_transparent_32%)]"
    ></div>
    <div
        class="relative mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-6 py-12 lg:px-10"
    >
        <Login
            githubStatus={data.appContext.githubStatus}
            user={data.appContext.user}
            error={data.error}
            probe={data.githubProbe}
            redirectTo={data.redirectTo}
            device={data.device}
        />
    </div>
</div>
