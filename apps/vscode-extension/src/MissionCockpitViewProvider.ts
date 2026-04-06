import * as vscode from 'vscode';
import type { MissionStageId } from '@flying-pillow/mission-core';
import { MissionSessionController } from './MissionSessionController.js';
import {
    buildMissionCockpitModel,
    type MissionCockpitMessage
} from './MissionCockpitViewModel.js';

export class MissionCockpitViewProvider
    implements vscode.WebviewViewProvider, vscode.Disposable {
    private webviewView: vscode.WebviewView | undefined;
    private selectedStageId: MissionStageId | undefined;
    private readonly disposables: vscode.Disposable[] = [];

    public constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly sessionController: MissionSessionController
    ) {
        this.disposables.push(
            this.sessionController.onDidMissionStatusChange(() => {
                void this.postModel();
            })
        );
    }

    public dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }

    public resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.webviewView = webviewView;
        const mediaRoot = vscode.Uri.joinPath(this.extensionUri, 'media', 'webview');
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [mediaRoot]
        };
        webviewView.webview.html = this.buildWebviewHtml(webviewView.webview, mediaRoot);
        this.disposables.push(
            webviewView.webview.onDidReceiveMessage((message: MissionCockpitMessage) => {
                void this.handleMessage(message);
            })
        );
        void this.postModel();
    }

    private async handleMessage(message: MissionCockpitMessage): Promise<void> {
        switch (message.type) {
            case 'refresh':
                await this.sessionController.refresh();
                return;
            case 'select-stage':
                this.selectedStageId = message.stageId;
                await this.postModel();
                return;
            case 'run-action':
                await this.sessionController.executeAction(message.actionId);
                return;
        }
    }

    private async postModel(): Promise<void> {
        if (!this.webviewView) {
            return;
        }

        const snapshot = this.sessionController.getSnapshot();
        const model = buildMissionCockpitModel(snapshot.status, this.selectedStageId);
        this.selectedStageId = model.selectedStageId;
        this.webviewView.webview.postMessage({
            type: 'cockpit-model',
            model
        });
    }

    private buildWebviewHtml(webview: vscode.Webview, mediaRoot: vscode.Uri): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(mediaRoot, 'mission-cockpit.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(mediaRoot, 'mission-cockpit.css')
        );
        const nonce = createNonce();
        const initialModel = buildMissionCockpitModel(
            this.sessionController.getSnapshot().status,
            this.selectedStageId
        );

        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Mission Cockpit</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}">window.__MISSION_COCKPIT_MODEL__ = ${serializeForScript(initialModel)};</script>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

function createNonce(): string {
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let value = '';
    for (let index = 0; index < 32; index += 1) {
        value += alphabet[Math.floor(Math.random() * alphabet.length)] ?? '0';
    }
    return value;
}

function serializeForScript(value: unknown): string {
    return JSON.stringify(value).replace(/</gu, '\\u003c');
}