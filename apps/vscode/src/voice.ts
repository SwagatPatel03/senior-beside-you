// Reading the narration aloud with the computer's own voice. Browser voices are not available inside
// VS Code's panel, so the extension speaks through the operating system: Windows' built-in speech,
// macOS's say, or spd-say or espeak on Linux when one is installed. Text is passed on standard input
// or as a single argument without a shell, so nothing in it can run as a command.

import { type ChildProcess, execFile, spawn } from 'node:child_process';
import * as vscode from 'vscode';

// One long-lived Windows PowerShell process, so each sentence starts at once instead of after the
// second it takes to load the speech engine. It answers "ready" once, then "spoken" per line.
const WINDOWS_SPEAKER = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::InputEncoding = [Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Speech',
  '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
  'if ($s.GetInstalledVoices().Count -eq 0) { exit 3 }',
  'if ($env:SENIOR_VOICE_VOLUME) { $s.Volume = [int]$env:SENIOR_VOICE_VOLUME }',
  "[Console]::Out.WriteLine('ready')",
  "while ($null -ne ($line = [Console]::In.ReadLine())) { if ($line.Trim()) { $s.Speak($line) }; [Console]::Out.WriteLine('spoken') }",
].join('; ');

const IDLE_MS = 15 * 60_000;

function runs(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => execFile(command, args, { timeout: 5000, windowsHide: true }, (err) => resolve(!err)));
}

export class Voice implements vscode.Disposable {
  /** Resolves to whether this computer can speak. */
  readonly ready: Promise<boolean>;
  private linuxCommand: string | null = null;
  private speaker: ChildProcess | null = null;
  private current: ChildProcess | null = null;
  private pending: (() => void)[] = [];
  private queue: Promise<void> = Promise.resolve();
  private generation = 0;
  private idle: NodeJS.Timeout | undefined;
  /** Why the last sentence could not be spoken, if it could not. */
  lastError: string | null = null;

  constructor() {
    this.ready = this.detect();
  }

  /** Speak after anything already queued. Resolves when this text has been spoken or dropped. */
  say(text: string): Promise<void> {
    const line = text.replace(/\s+/g, ' ').trim();
    if (!line) return Promise.resolve();
    const generation = this.generation;
    this.queue = this.queue
      .then(() => (generation === this.generation ? this.speak(line) : undefined))
      .then(() => {
        this.lastError = null;
      })
      .catch((err: unknown) => {
        this.lastError = err instanceof Error ? err.message : String(err);
      });
    return this.queue;
  }

  /** Load the speech engine ahead, so the first sentence starts at once. Reading aloud must be on. */
  async warm(): Promise<void> {
    if (process.platform !== 'win32') return;
    await this.windowsSpeaker();
    this.restartIdleTimer();
  }

  private restartIdleTimer(): void {
    clearTimeout(this.idle);
    // Close the speaker when it has been quiet for a while; the next sentence starts it again.
    this.idle = setTimeout(() => {
      this.speaker?.kill();
      this.speaker = null;
    }, IDLE_MS);
  }

  /** Stop speaking now and drop everything queued. */
  stop(): void {
    this.generation++;
    clearTimeout(this.idle);
    this.current?.kill();
    this.current = null;
    this.speaker?.kill();
    this.speaker = null;
    for (const done of this.pending.splice(0)) done();
  }

  /** Windows and macOS always ship a voice; Linux has one only when a speech command is installed. */
  private async detect(): Promise<boolean> {
    if (process.platform === 'win32' || process.platform === 'darwin') return true;
    for (const command of ['spd-say', 'espeak']) {
      if (await runs(command, ['--version'])) {
        this.linuxCommand = command;
        return true;
      }
    }
    return false;
  }

  private async speak(line: string): Promise<void> {
    if (!(await this.ready)) return;
    if (process.platform === 'win32') {
      clearTimeout(this.idle);
      const speaker = await this.windowsSpeaker();
      if (!speaker?.stdin) throw new Error('The Windows voice could not start.');
      await new Promise<void>((resolve) => {
        this.pending.push(resolve);
        speaker.stdin?.write(`${line}\n`);
      });
      this.restartIdleTimer();
      return;
    }
    const [command, args] = process.platform === 'darwin' ? ['say', [line]] : [this.linuxCommand as string, this.linuxCommand === 'spd-say' ? ['-w', line] : [line]];
    try {
      await new Promise<void>((resolve, reject) => {
        this.current = execFile(command, args, { windowsHide: true }, (err) => (err && !err.killed ? reject(err) : resolve()));
      });
    } finally {
      this.current = null;
    }
  }

  private windowsSpeaker(): Promise<ChildProcess | null> {
    if (this.speaker && this.speaker.exitCode === null) return Promise.resolve(this.speaker);
    return new Promise((resolve) => {
      let child: ChildProcess;
      try {
        child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SPEAKER], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      } catch {
        resolve(null);
        return;
      }
      let buffer = '';
      let started = false;
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        buffer += chunk;
        let nl: number;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const word = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (word === 'ready' && !started) {
            started = true;
            this.speaker = child;
            resolve(child);
          } else if (word === 'spoken') this.pending.shift()?.();
        }
      });
      const failed = () => {
        if (this.speaker === child) this.speaker = null;
        for (const done of this.pending.splice(0)) done();
        if (!started) resolve(null);
      };
      child.on('error', failed);
      child.on('exit', failed);
    });
  }

  dispose(): void {
    this.stop();
  }
}
