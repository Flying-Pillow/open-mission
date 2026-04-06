/**
 * @file apps/vscode-extension/src/webview/cockpit-main.ts
 * @description Mounts the Mission flight controller cockpit inside the sidebar webview.
 */

import { mount } from 'svelte';
import type { MissionCockpitModel } from '../MissionCockpitViewModel.js';
import CockpitApp from './CockpitApp.svelte';
import './app.css';

declare global {
	interface Window {
		__MISSION_COCKPIT_MODEL__?: MissionCockpitModel;
	}
}

const target = document.getElementById('app');
const initialModel = window.__MISSION_COCKPIT_MODEL__;

if (!target || !initialModel) {
	throw new Error('Mission cockpit bootstrap failed.');
}

mount(CockpitApp, {
	target
});