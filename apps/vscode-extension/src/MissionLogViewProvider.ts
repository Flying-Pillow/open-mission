import * as vscode from 'vscode';
import { MissionLogChannel, type MissionLogModel } from './MissionLogChannel.js';

type MissionLogHostMessage = {
    type: 'mission-log-model';
    model: MissionLogModel;
};

type MissionLogMessage = {
    type: 'show-output-channel';
};

export class MissionLogViewProvider
    implements vscode.WebviewViewProvider, vscode.Disposable {
    private webviewView: vscode.WebviewView | undefined;
    private readonly disposables: vscode.Disposable[] = [];

    public constructor(
        private readonly logChannel: MissionLogChannel
    ) {
        this.disposables.push(
            this.logChannel.onDidChange(() => {
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
        webviewView.webview.options = {
            enableScripts: true
        };
        webviewView.webview.html = this.buildWebviewHtml(webviewView.webview);
        this.disposables.push(
            webviewView.webview.onDidReceiveMessage((message: MissionLogMessage) => {
                if (message.type === 'show-output-channel') {
                    this.logChannel.show(true);
                }
            })
        );
        void this.postModel();
    }

    private async postModel(): Promise<void> {
        if (!this.webviewView) {
            return;
        }

        await this.webviewView.webview.postMessage({
            type: 'mission-log-model',
            model: this.logChannel.getModel()
        } satisfies MissionLogHostMessage);
    }

    private buildWebviewHtml(webview: vscode.Webview): string {
        const nonce = createNonce();
        const initialModel = this.logChannel.getModel();

        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Mission Log</title>
  <style>
    :root {
      color-scheme: light dark;
    }

    body {
      margin: 0;
      font-family: var(--vscode-font-family);
      background: var(--vscode-sideBar-background);
      color: var(--vscode-foreground);
    }

    .shell {
      display: grid;
      grid-template-rows: auto 1fr;
      min-height: 100vh;
    }

    .header {
      border-bottom: 1px solid var(--vscode-panel-border);
      padding: 12px 14px;
      display: grid;
      gap: 10px;
      background: color-mix(in srgb, var(--vscode-sideBar-background) 82%, var(--vscode-editor-background) 18%);
    }

    .eyebrow {
      margin: 0;
      font-size: 11px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground);
    }

    .summary {
      margin: 0;
      font-size: 12px;
      line-height: 1.5;
      color: var(--vscode-descriptionForeground);
    }

    .actions {
      display: flex;
      gap: 8px;
    }

    button {
      border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border-radius: 999px;
      padding: 6px 10px;
      font: inherit;
      font-size: 12px;
      cursor: pointer;
    }

    button:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .log-region {
      overflow: auto;
      padding: 14px;
    }

    .empty {
      margin: 0;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      line-height: 1.6;
    }

    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
      font-size: 12px;
      line-height: 1.55;
    }
  </style>
</head>
<body>
  <div class="shell">
    <header class="header">
      <div>
        <p class="eyebrow">Mission</p>
        <p id="summary" class="summary"></p>
      </div>
      <div class="actions">
        <button id="show-output-channel" type="button">Open Output Channel</button>
      </div>
    </header>
    <section id="log-region" class="log-region">
      <p id="empty" class="empty"></p>
      <pre id="log"></pre>
    </section>
  </div>
  <script nonce="${nonce}">
    const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
    const summary = document.getElementById('summary');
    const empty = document.getElementById('empty');
    const log = document.getElementById('log');
    const logRegion = document.getElementById('log-region');
    const initialModel = ${serializeForScript(initialModel)};

    const render = (model) => {
      const pinnedToBottom = Math.abs((logRegion.scrollHeight - logRegion.clientHeight) - logRegion.scrollTop) < 24;
      summary.textContent = model.summary;
      const content = model.lines.join('\n');
      log.textContent = content;
      const hasLines = model.lines.length > 0;
      empty.textContent = hasLines ? '' : 'Mission daemon and extension logs will appear here.';
      empty.hidden = hasLines;
      log.hidden = !hasLines;
      if (pinnedToBottom) {
        requestAnimationFrame(() => {
          logRegion.scrollTop = logRegion.scrollHeight;
        });
      }
    };

    document.getElementById('show-output-channel')?.addEventListener('click', () => {
      vscode?.postMessage({ type: 'show-output-channel' });
    });

    window.addEventListener('message', (event) => {
      if (event.data?.type !== 'mission-log-model') {
        return;
      }
      render(event.data.model);
    });

    render(initialModel);
  </script>
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