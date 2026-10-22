// The local endpoint Claude Code's senior plugin talks to. It listens on 127.0.0.1 only, on a random
// port, and writes a lock file to ~/.senior/ide/ so the plugin can find it. Every request must carry
// the secret token from that file, must not come from a web page, and must name this exact host.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

const MAX_BODY = 1024 * 1024;

export type ToolHandler = (name: string, args: Record<string, unknown>, signal: AbortSignal, project?: string) => Promise<unknown>;

export function lockDir(): string {
  return process.env.SENIOR_IDE_DIR || path.join(os.homedir(), '.senior', 'ide');
}

export class BridgeServer implements vscode.Disposable {
  private server: http.Server | null = null;
  private readonly token = randomBytes(24).toString('hex');
  private lockFile: string | null = null;
  private port = 0;
  private readonly folderWatch: vscode.Disposable;

  constructor(
    private readonly handle: ToolHandler,
    private readonly version: string,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.folderWatch = vscode.workspace.onDidChangeWorkspaceFolders(() => this.writeLock());
  }

  async start(): Promise<number> {
    const server = http.createServer((req, res) => void this.onRequest(req, res));
    server.keepAliveTimeout = 5000;
    server.requestTimeout = 0; // guide calls wait for the user on purpose
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    this.server = server;
    this.port = (server.address() as { port: number }).port;
    this.writeLock();
    this.log.info(`Bridge listening on 127.0.0.1:${this.port}`);
    return this.port;
  }

  get address(): { port: number; token: string } {
    return { port: this.port, token: this.token };
  }

  private writeLock(): void {
    if (!this.port) return;
    const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    const dir = lockDir();
    fs.mkdirSync(dir, { recursive: true });
    this.lockFile = path.join(dir, `${this.port}.json`);
    const lock = { pid: process.pid, port: this.port, token: this.token, workspaceFolders: folders, app: vscode.env.appName, version: this.version, startedAt: new Date().toISOString() };
    fs.writeFileSync(this.lockFile, JSON.stringify(lock, null, 2), { mode: 0o600 });
  }

  private authorised(req: http.IncomingMessage): string | null {
    if (req.headers.origin) return 'Requests from web pages are not accepted.';
    if (req.headers.host !== `127.0.0.1:${this.port}`) return 'Unexpected host.';
    const given = Buffer.from(String(req.headers.authorization ?? ''));
    const wanted = Buffer.from(`Bearer ${this.token}`);
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return 'Wrong or missing token.';
    return null;
  }

  private async onRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const reply = (status: number, body: unknown) => {
      if (res.writableEnded || res.destroyed) return;
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    };
    const problem = this.authorised(req);
    if (problem) return reply(403, { error: problem });
    if (req.method !== 'POST' || req.url !== '/tool') return reply(404, { error: 'Not found.' });

    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY) return reply(413, { error: 'The request is too large.' });
      chunks.push(chunk as Buffer);
    }
    let call: { name?: unknown; args?: unknown; project?: unknown };
    try {
      call = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return reply(400, { error: 'The body must be JSON.' });
    }
    if (typeof call.name !== 'string') return reply(400, { error: 'The call needs a tool name.' });

    const controller = new AbortController();
    res.on('close', () => controller.abort());
    try {
      const project = typeof call.project === 'string' ? call.project : undefined;
      const result = await this.handle(call.name, (call.args ?? {}) as Record<string, unknown>, controller.signal, project);
      reply(200, { result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn(`${call.name} failed: ${message}`);
      reply(400, { error: message });
    }
  }

  dispose(): void {
    this.folderWatch.dispose();
    this.server?.close();
    this.server?.closeAllConnections?.();
    if (this.lockFile) fs.rmSync(this.lockFile, { force: true });
  }
}
