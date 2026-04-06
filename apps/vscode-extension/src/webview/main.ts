/**
 * @file apps/vscode-extension/src/webview/main.ts
 * @description Mounts the Mission Svelte webview application inside the roadmap panel.
 */

import { mount } from 'svelte';
import type { MissionTimelineModel } from '../MissionTimelineViewModel.js';
import '@xyflow/svelte/dist/style.css';
import App from './App.svelte';
import './app.css';

declare global {
	interface Window {
		__MISSION_TIMELINE_MODEL__?: MissionTimelineModel;
	}
}

const target = document.getElementById('app');
const initialModel = window.__MISSION_TIMELINE_MODEL__;

if (!target || !initialModel) {
	throw new Error('Mission webview bootstrap failed.');
}

mount(App, {
	target
});