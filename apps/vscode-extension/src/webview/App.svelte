<!--
	@file apps/vscode-extension/src/webview/App.svelte
	@description Renders the Mission roadmap, console, and dependency graph tabs inside the VS Code webview.
-->
<svelte:options runes={true} />

<script lang="ts">
  import { onMount } from 'svelte';
  import ConsoleTab from './ConsoleTab.svelte';
  import GraphTab from './GraphTab.svelte';
  import RoadmapTab from './RoadmapTab.svelte';
  import type {
    MissionRoadmapMessage,
    MissionTimelineHostMessage,
    MissionTimelineModel,
    MissionTimelineTask,
  } from '../MissionTimelineViewModel.js';

  type TabId = 'roadmap' | 'console' | 'graph';
  type GraphScope = 'all' | 'selected';
  type VsCodeApi = {
    postMessage(message: MissionRoadmapMessage): void;
  };

  const missionGlobal = globalThis as typeof globalThis & {
    __MISSION_TIMELINE_MODEL__?: MissionTimelineModel;
    acquireVsCodeApi?: () => VsCodeApi;
  };
  const initialModel = missionGlobal.__MISSION_TIMELINE_MODEL__;

  if (!initialModel) {
    throw new Error('Mission model is missing.');
  }

  let model = $state(structuredClone(initialModel));
  let activeTab = $state<TabId>('roadmap');
  let graphScope = $state<GraphScope>('all');
  let selectedTaskId = $state(
    initialModel.tasks.find((task) => task.name === initialModel.currentSlice)?.id ??
      initialModel.tasks[0]?.id ??
      ''
  );
  let vscodeApi: VsCodeApi | undefined;

  onMount(() => {
    const acquireVsCodeApi = missionGlobal.acquireVsCodeApi;
    if (typeof acquireVsCodeApi === 'function') {
      vscodeApi = acquireVsCodeApi();
    }

    const handleMessage = (event: MessageEvent<MissionTimelineHostMessage>) => {
      const payload = event.data;
      if (payload?.type !== 'console-event') {
        return;
      }

      model = {
        ...model,
        consoleState: payload.event.state,
      };

      if (payload.event.state.awaitingInput) {
        activeTab = 'console';
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  });

  function postMessage(message: MissionRoadmapMessage): void {
    vscodeApi?.postMessage(message);
  }

  function openGuidance(task: MissionTimelineTask): void {
    selectedTaskId = task.id;
    graphScope = 'selected';
    const nextTask = task.workItems.find((item) => !item.completed);
    postMessage({
      type: 'guide-slice',
      sliceTitle: task.name,
      sliceId: task.id,
      taskId: nextTask?.taskId,
      taskTitle: nextTask?.title,
    });
    activeTab = 'console';
  }

  function toggleTask(task: MissionTimelineTask, taskId: string, completed: boolean): void {
    postMessage({
      type: 'toggle-task',
      taskId,
      completed,
    });
  }

  function sendConsoleReply(text: string): void {
    const normalized = text.trim();
    if (!normalized) {
      return;
    }

    postMessage({
      type: 'console-reply',
      text: normalized,
    });
  }

  function selectTask(taskId: string): void {
    selectedTaskId = taskId;
  }

  function showFullGraph(): void {
    graphScope = 'all';
  }

  function setGraphScope(scope: GraphScope): void {
    graphScope = scope;
  }
</script>

<svelte:head>
  <title>{model.missionId} Roadmap</title>
</svelte:head>

<div class="min-h-screen px-5 pb-6 pt-4 text-(--vscode-editor-foreground)">
  <header class="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
    <div>
      <h1 class="m-0 text-[20px] font-semibold">{model.missionId} Roadmap</h1>
      <p class="mc-muted mt-1 text-sm">
        Stage: {model.stage}
        {#if model.currentSlice}
          <span> | Active flight in progress</span>
        {/if}
      </p>
    </div>
    <div class="max-w-2xl text-sm leading-6 text-(--vscode-descriptionForeground)">
      Use the roadmap to track execution details and the graph to inspect flight dependencies before
      opening guidance for the next step.
    </div>
  </header>

  <nav class="mb-4 flex flex-wrap gap-2">
    <button
      type="button"
      class={activeTab === 'roadmap'
        ? 'mc-tab-active rounded-full border px-4 py-2 text-sm font-semibold'
        : 'mc-tab-idle rounded-full border px-4 py-2 text-sm font-semibold'}
      onclick={() => {
        activeTab = 'roadmap';
      }}
    >
      Roadmap
    </button>
    <button
      type="button"
      class={activeTab === 'console'
        ? 'mc-tab-active rounded-full border px-4 py-2 text-sm font-semibold'
        : 'mc-tab-idle rounded-full border px-4 py-2 text-sm font-semibold'}
      onclick={() => {
        activeTab = 'console';
      }}
    >
      Console
    </button>
    <button
      type="button"
      class={activeTab === 'graph'
        ? 'mc-tab-active rounded-full border px-4 py-2 text-sm font-semibold'
        : 'mc-tab-idle rounded-full border px-4 py-2 text-sm font-semibold'}
      onclick={() => {
        activeTab = 'graph';
      }}
    >
      Graph
    </button>
  </nav>

  {#if activeTab === 'roadmap'}
    <RoadmapTab tasks={model.tasks} onOpenGuidance={openGuidance} onToggleTask={toggleTask} />
  {:else if activeTab === 'console'}
    <ConsoleTab consoleState={model.consoleState} onSendReply={sendConsoleReply} />
  {:else}
    <GraphTab
      tasks={model.tasks}
      currentSlice={model.currentSlice}
      {selectedTaskId}
      {graphScope}
      onSelectTask={selectTask}
      onSetGraphScope={setGraphScope}
      onOpenGuidance={openGuidance}
    />
  {/if}
</div>
