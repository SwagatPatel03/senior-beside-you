import type { JournalEntry, PieceView } from '../src/panel/protocol.ts';
import { send } from './vscode.ts';

const PIECE_STATUS: Record<PieceView['status'], { glyph: string; label: string }> = {
  waiting: { glyph: '○', label: 'waiting' },
  active: { glyph: '◐', label: 'now' },
  typed: { glyph: '●', label: 'written by you' },
  accepted: { glyph: '●', label: 'accepted' },
  watched: { glyph: '●', label: 'watched' },
  filled: { glyph: '◆', label: 'filled in' },
  kept_own: { glyph: '●', label: 'your version' },
  skipped: { glyph: '–', label: 'skipped' },
  failed: { glyph: '×', label: 'could not be placed' },
};

// What each kind of piece is called in the panel: the user's to write, Senior's, or a probe.
const KIND_LABEL: Record<PieceView['kind'], string> = { spine: 'Yours', flesh: "Senior's", probe: 'Probe' };

function FileLink({ file, line }: { file: string; line?: number }) {
  return (
    <button class="file link" title={`Open ${file}`} onClick={() => send({ type: 'openFile', file, ...(line ? { line } : {}) })}>
      {file}
      {line ? `:${line}` : ''}
    </button>
  );
}

function Said({ label, tone, text }: { label: string; tone: string; text: string }) {
  return (
    <article class={`said ${tone}`}>
      <span class="label">{label}</span>
      <p>{text}</p>
    </article>
  );
}

function Pieces({ pieces }: { pieces: PieceView[] }) {
  // Most steps change one file; name it once instead of on every piece.
  const shared = new Set(pieces.map((p) => p.file)).size === 1 ? pieces[0].file : null;
  return (
    <section class="pieces-block">
      {shared && (
        <p class="pieces-file">
          <FileLink file={shared} />
        </p>
      )}
      <ol class="pieces">
        {pieces.map((p) => (
          <li key={p.index} class={`piece ${p.status}`}>
            <span class="glyph" aria-hidden="true">
              {PIECE_STATUS[p.status].glyph}
            </span>
            <div>
              <div class="piece-head">
                <span class={`kind ${p.kind}`}>{KIND_LABEL[p.kind]}</span>
                {!shared && <FileLink file={p.file} />}
                <span class="state">{PIECE_STATUS[p.status].label}</span>
              </div>
              <p class="why">{p.why}</p>
              {p.expect && <p class="expect">If the guess is right: {p.expect}</p>}
              {p.detail && p.status === 'failed' && <p class="detail">{p.detail}</p>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Entry({ entry }: { entry: JournalEntry }) {
  switch (entry.kind) {
    case 'narration':
      return <Said label="Senior" tone="narration" text={entry.text} />;
    case 'answer':
      return <Said label="Answer" tone="answer" text={entry.text} />;
    case 'callback':
      return <Said label="Remember" tone="callback" text={entry.text} />;
    case 'takeaway':
      return <Said label="Takeaway" tone="takeaway" text={entry.text} />;
    case 'warning':
      return <Said label="Risk" tone="warning" text={entry.text} />;
    case 'question':
      return (
        <article class={`asked ${entry.answered ? 'answered' : ''}`}>
          <span class="label">You asked{entry.answered ? '' : ' · waiting for Claude Code'}</span>
          <p>{entry.text}</p>
          {entry.where && <code class="where">{entry.where}</code>}
        </article>
      );
    case 'step':
      return (
        <section class="step">
          <span class="label">
            Step {entry.step.index} of {entry.step.total}
          </span>
          <h2>{entry.step.title}</h2>
          <p>{entry.step.why}</p>
          <p class="expect">
            <span class="label">Expect</span> {entry.step.expect}
          </p>
        </section>
      );
    case 'pieces':
      return <Pieces pieces={entry.pieces} />;
    case 'check':
      return (
        <section class={`check ${entry.passed ? 'passed' : 'failed'}`}>
          <div class="check-head">
            <span class="label">Check</span>
            <span class="verdict">{entry.passed ? 'As expected' : 'Not as expected'}</span>
          </div>
          <code class="command">{entry.command}</code>
          <p class="expect">Expected: {entry.expected}</p>
          {entry.output && (
            <details>
              <summary>Output</summary>
              <pre>{entry.output}</pre>
            </details>
          )}
        </section>
      );
    case 'summary':
      return (
        <section class="summary">
          <span class="label">Step done</span>
          <p>{entry.summary}</p>
          {entry.verified.length > 0 && (
            <ul class="verified">
              {entry.verified.map((v) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
          )}
          {entry.notVerified.length > 0 && (
            <ul class="not-verified">
              {entry.notVerified.map((v) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
          )}
          {entry.takeaway && (
            <p class="takeaway-line">
              <span class="label">Takeaway</span> {entry.takeaway}
            </p>
          )}
        </section>
      );
    case 'open':
      return (
        <p class="opened">
          <FileLink file={entry.file} line={entry.line} /> {entry.why}
        </p>
      );
    case 'notice':
      return <p class={`notice ${entry.tone ?? 'info'}`}>{entry.text}</p>;
  }
}
