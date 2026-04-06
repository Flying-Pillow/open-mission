<svelte:options runes={true} />

<script lang="ts">
  import { onMount } from 'svelte';
  import type {
    MissionCockpitActionModel,
    MissionCockpitHostMessage,
    MissionCockpitMessage,
    MissionCockpitModel,
    MissionCockpitStageModel,
  } from '../MissionCockpitViewModel.js';

  type VsCodeApi = {
    postMessage(message: MissionCockpitMessage): void;
  };

  const missionGlobal = globalThis as typeof globalThis & {
    __MISSION_COCKPIT_MODEL__?: MissionCockpitModel;
    acquireVsCodeApi?: () => VsCodeApi;
  };

  const initialModel = missionGlobal.__MISSION_COCKPIT_MODEL__;

  if (!initialModel) {
    throw new Error('Mission cockpit model is missing.');
  }

  let model = $state(structuredClone(initialModel));
  let vscodeApi: VsCodeApi | undefined;

  onMount(() => {
    if (typeof missionGlobal.acquireVsCodeApi === 'function') {
      vscodeApi = missionGlobal.acquireVsCodeApi();
    }

    const handleMessage = (event: MessageEvent<MissionCockpitHostMessage>) => {
      if (event.data?.type !== 'cockpit-model') {
        return;
      }

      model = structuredClone(event.data.model);
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  });

  function postMessage(message: MissionCockpitMessage): void {
    vscodeApi?.postMessage(message);
  }

  function selectStage(stage: MissionCockpitStageModel): void {
    postMessage({ type: 'select-stage', stageId: stage.stageId });
  }

  function runAction(action: MissionCockpitActionModel): void {
    if (!action.enabled) {
      return;
    }

    if (action.confirmationPrompt && !window.confirm(action.confirmationPrompt)) {
      return;
    }

    postMessage({ type: 'run-action', actionId: action.id });
  }

  const selectedStage = $derived.by(() =>
    model.stages.find((stage) => stage.stageId === model.selectedStageId)
  );
</script>

<div class="mc-cockpit-shell min-h-screen p-4 text-(--vscode-foreground)">
  <section class="mb-4 rounded-3xl border border-white/10 bg-black/10 p-4">
    <div class="flex items-start justify-between gap-3">
      <div>
        <p class="m-0 text-[11px] uppercase tracking-[0.24em] text-slate-400">Mission Cockpit</p>
        <h1 class="m-0 mt-2 text-xl font-semibold tracking-tight">{model.title}</h1>
        <p class="m-0 mt-2 text-sm text-slate-300">{model.summary}</p>
      </div>
      <!-- svelte-ignore event_directive_deprecated -->
      <button
        type="button"
        class="rounded-full border border-white/15 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-200 transition hover:border-sky-300/50 hover:text-sky-100"
        on:click={() => postMessage({ type: 'refresh' })}
      >
        Refresh
      </button>
    </div>
  </section>

  <section class="mb-4 rounded-3xl border border-white/10 bg-black/10 p-4">
    <div class="mb-3 flex items-center justify-between gap-3">
      <h2 class="m-0 text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">Stages</h2>
      {#if selectedStage}
        <span
          class="rounded-full border border-sky-300/30 bg-sky-300/10 px-3 py-1 text-[11px] font-semibold uppercase text-sky-100"
        >
          {selectedStage.label}
        </span>
      {/if}
    </div>

    {#if model.stages.length === 0}
      <p class="m-0 text-sm text-slate-400">
        No stage projection is available for the current selection.
      </p>
    {:else}
      <div class="grid gap-2">
        {#each model.stages as stage (stage.stageId)}
          <!-- svelte-ignore event_directive_deprecated -->
          <button
            type="button"
            class={`rounded-2xl border px-3 py-3 text-left transition ${stage.selected ? 'border-sky-300/50 bg-sky-300/10' : 'border-white/10 bg-white/5 hover:border-white/20'}`}
            on:click={() => selectStage(stage)}
          >
            <div class="flex items-center justify-between gap-3">
              <div>
                <div class="text-sm font-semibold text-slate-100">{stage.label}</div>
                <div class="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400">
                  {stage.status}
                </div>
              </div>
              <div class="text-right text-xs text-slate-300">
                <div>{stage.completedTaskCount}/{stage.taskCount}</div>
                <div class="mt-1 uppercase tracking-[0.16em] text-slate-500">tasks</div>
              </div>
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </section>

  <section class="rounded-3xl border border-white/10 bg-black/10 p-4">
    <div class="mb-3 flex items-center justify-between gap-3">
      <h2 class="m-0 text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">Actions</h2>
      {#if model.selectedStageId}
        <span class="text-xs text-slate-400">Projected for {model.selectedStageId}</span>
      {/if}
    </div>

    {#if model.actions.length === 0}
      <p class="m-0 text-sm text-slate-400">{model.emptyMessage ?? 'No actions available.'}</p>
    {:else}
      <div class="grid gap-3">
        {#each model.actions as action (action.id)}
          <div class="rounded-2xl border border-white/10 bg-white/5 p-3">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="text-sm font-semibold text-slate-100">{action.label}</div>
                <div class="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400">
                  {action.action}
                </div>
                {#if action.targetId}
                  <div class="mt-2 break-all text-xs text-slate-300">
                    Target: {action.targetId}
                  </div>
                {/if}
              </div>
              <!-- svelte-ignore event_directive_deprecated -->
              <button
                type="button"
                class={`rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] ${action.enabled ? 'border border-sky-300/40 bg-sky-300/10 text-sky-100 hover:border-sky-200/70' : 'border border-white/10 bg-white/5 text-slate-500'}`}
                disabled={!action.enabled}
                title={action.enabled ? action.label : action.disabledReason}
                on:click={() => runAction(action)}
              >
                {action.enabled ? 'Run' : 'Disabled'}
              </button>
            </div>
            {#if !action.enabled && action.disabledReason}
              <p class="m-0 mt-3 text-sm text-amber-200">{action.disabledReason}</p>
            {/if}
            {#if action.confirmationPrompt}
              <p class="m-0 mt-2 text-xs text-slate-400">
                Confirmation: {action.confirmationPrompt}
              </p>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>
</div>
