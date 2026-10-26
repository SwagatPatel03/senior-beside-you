// The Senior panel in the side bar. The page itself lives in webview/; this side hosts it and
// relays messages.

import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { SessionStore } from '../session.ts';
import type { FromPanel, ToPanel } from './protocol.ts';

const SPOKEN = new Set(['narration', 'answer', 'callback', 'takeaway', 'warning']);

export class PanelProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'senior.panel';
  private view: vscode.WebviewView | null = null;
  private readonly subscriptions: vscode.Disposable[] = [];
  private metaQueued = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly session: SessionStore,
    private readonly onMessage: (message: FromPanel) => void,
    /** Reads text aloud with the computer's voice. Called only when the user has turned reading aloud on. */
    private readonly say: (text: string) => void,
  ) {
    this.subscriptions.push(
      session.onEntry((entry) => {
        this.post({ type: 'entry', entry });
        if (!this.session.readAloud) return;
        // The narration was prepared ahead, so it can be spoken the moment its step or piece starts.
        if (entry.kind === 'step') this.speak(`${entry.step.title}. ${entry.step.why}`);
        else if (entry.kind === 'explain' && entry.why) this.speak(entry.why);
        else if (SPOKEN.has(entry.kind) && 'text' in entry) this.speak(entry.text);
      }),
      session.onMeta(() => {
        this.queueMeta();
        this.speakActivePiece();
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('senior')) this.queueMeta();
      }),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const dist = vscode.Uri.joinPath(this.extensionUri, 'dist');
    view.webview.options = { enableScripts: true, localResourceRoots: [dist] };
    view.webview.html = this.html(view.webview, dist);
    view.webview.onDidReceiveMessage((message: FromPanel) => {
      if (message.type === 'ready') this.post({ type: 'state', state: this.session.snapshot() });
      else this.onMessage(message);
    });
    view.onDidDispose(() => {
      if (this.view === view) this.view = null;
    });
  }

  /** Show the panel. If it has never been opened, open it; it then shows the whole journal. */
  reveal(): void {
    if (this.view) this.view.show?.(true);
    else void vscode.commands.executeCommand(`${PanelProvider.viewId}.focus`);
  }

  private spokenPiece = '';

  /** Read out why a piece the user is about to write exists, once, as it becomes their turn. */
  private speakActivePiece(): void {
    const active = this.session.active;
    const key = active ? `${active.index}/${active.total}/${active.file}/${active.why}` : '';
    if (key === this.spokenPiece) return;
    this.spokenPiece = key;
    if (active && active.kind !== 'flesh' && this.session.readAloud) this.speak(active.notice ? `${active.why} ${active.notice}` : active.why);
  }

  private speak(text: string): void {
    this.say(text);
  }

  private queueMeta(): void {
    if (this.metaQueued) return;
    this.metaQueued = true;
    setTimeout(() => {
      this.metaQueued = false;
      this.post({ type: 'meta', meta: this.session.meta() });
    }, 30);
  }

  private post(message: ToPanel): void {
    void this.view?.webview.postMessage(message);
  }

  private html(webview: vscode.Webview, dist: vscode.Uri): string {
    const nonce = randomBytes(16).toString('base64');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.css'));
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
    ].join('; ');
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="${style}">
  <title>Senior</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }

  dispose(): void {
    for (const s of this.subscriptions) s.dispose();
  }
}
