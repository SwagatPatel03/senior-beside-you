import { Fragment, type ComponentChildren } from 'preact';
import type { DecisionDetail, JournalEntry, PieceView } from '../src/panel/protocol.ts';
import { ChoiceCard, IdiomCard, Lesson, LessonReview, LevelChanged, Suggestion, TechChip } from './lesson.tsx';
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

/** Lower-case the first letter so a stored sentence can continue another, unless it starts with a name such as SQL. */
export function lowerFirst(text: string): string {
  return /^[A-Z](?:[a-z]|\s)/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
}

export function FileLink({ file, line }: { file: string; line?: number }) {
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
            <div class="piece-body">
              <div class="piece-head">
                <span class={`kind ${p.kind}`}>{KIND_LABEL[p.kind]}</span>
                {p.kind !== 'flesh' && <TechChip teach={p.teach} />}
                {!shared && <FileLink file={p.file} />}
                <span class="state">{p.revealed && p.status !== 'active' ? `${PIECE_STATUS[p.status].label}, after seeing the code` : PIECE_STATUS[p.status].label}</span>
              </div>
              <p class="why">{p.why}</p>
              {p.expect && <p class="expect">If the guess is right: {p.expect}</p>}
              {p.detail && p.status === 'failed' && <p class="detail">{p.detail}</p>}
              {p.status === 'active' ? <Lesson piece={p} /> : p.status !== 'waiting' && <LessonReview piece={p} />}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Part({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <section class="part">
      <span class="label">{label}</span>
      {children}
    </section>
  );
}

/**
 * One ledger decision in full: the parts the hover card shows, then everything else, then the
 * stored record. Inside a list that already shows its id and title, `bare` leaves them out.
 */
export function DecisionCard({ d, bare = false, onDecision }: { d: DecisionDetail; bare?: boolean; onDecision?: (id: string) => void }) {
  const replaces = d.replaces;
  const openDecision = onDecision ?? ((id: string) => send({ type: 'showDecision', id }));
  return (
    <article class={`decision-card ${bare ? 'bare' : ''}`}>
      {!bare && (
        <>
          <div class="decision-head">
            <code>{d.id}</code>
            <span class="chip">{d.undo}</span>
            <span class={`chip ${d.replacedBy ? 'old' : 'live'}`}>{d.replacedBy ? `Replaced by ${d.replacedBy}` : 'Still in force'}</span>
          </div>
          <h2>{d.title}</h2>
        </>
      )}
      <Part label="What we chose">
        <p>{d.chosen}</p>
      </Part>
      <Part label="Why">
        <p>{d.why}</p>
      </Part>
      {d.rejected.length > 0 && (
        <Part label="What we turned down">
          {d.rejected.map((r) => (
            <p key={r.option}>
              <strong>{r.option}.</strong> {r.why}
            </p>
          ))}
        </Part>
      )}
      {d.guards && (
        <Part label="It protects against">
          <p>{d.guards}</p>
        </Part>
      )}
      {d.payoff && (
        <Part label="When you will see it matter">
          <p>{d.payoff}</p>
        </Part>
      )}
      {d.examples.length > 0 && (
        <Part label={d.examples.length === 1 ? 'An example' : 'Examples'}>
          {d.examples.map((x) => (
            <p key={x}>{x}</p>
          ))}
        </Part>
      )}
      {replaces && (
        <Part label="What it replaced">
          <p>
            <button class="link" onClick={() => openDecision(replaces.id)}>
              {replaces.id}
            </button>
            {replaces.title ? ` ${replaces.title}.` : '.'}
            {replaces.chosen ? ` Before, we chose ${lowerFirst(replaces.chosen)}.` : ''}
          </p>
        </Part>
      )}
      <Part label="Where it lives in the code">
        {d.files.length === 0 && d.symbols.length === 0 ? (
          <p>It is not linked to any code yet. It is linked when the step of the plan that carries it out is built.</p>
        ) : (
          <ul class="links">
            {d.symbols.map((sym) => (
              <li key={`s:${sym}`}>
                <code>{sym}</code>
              </li>
            ))}
            {d.files.map((file) => (
              <li key={`f:${file.path}`}>{file.open ? <FileLink file={file.path} /> : <code>{file.path}</code>}</li>
            ))}
          </ul>
        )}
      </Part>
      {d.regrets.length > 0 && (
        <Part label="From the regret library">
          <p>{d.regrets.join(', ')}</p>
        </Part>
      )}
      {d.checks.length > 0 && (
        <Part label="Checks done before deciding">
          {d.checks.map((c) => (
            <p key={c.label}>
              <strong>{c.label}:</strong> {c.result}
            </p>
          ))}
        </Part>
      )}
      <Part label="History">
        {d.history.map((h, i) => (
          <p key={i}>{h}</p>
        ))}
      </Part>
      <details>
        <summary>Show the original record</summary>
        <p class="record-file">
          This is <code>{d.record.file}</code>, exactly as it is stored.
        </p>
        <pre>{d.record.json}</pre>
      </details>
    </article>
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
          {entry.evidence && entry.evidence.length > 0 && (
            <p class="evidence">
              <span class="label">It points at</span>{' '}
              {entry.evidence.map((place, i) => (
                <Fragment key={`${place.file}:${place.line}`}>
                  {i > 0 && ', '}
                  <FileLink file={place.file} line={place.line} />
                </Fragment>
              ))}
            </p>
          )}
          {entry.risk && (
            <p class="evidence">
              <span class="label">The risk named for this step</span> {entry.risk}
            </p>
          )}
          {entry.output && (
            <details>
              <summary>Output</summary>
              <pre>{entry.output}</pre>
            </details>
          )}
        </section>
      );
    case 'explain':
      return (
        <article class="said explain">
          <span class="label">About this line</span>
          <code class="where">{entry.where}</code>
          {entry.why && <p>{entry.why}</p>}
          {entry.notice && (
            <p class="notice-line">
              <span class="label">Notice</span> {entry.notice}
            </p>
          )}
          {entry.decisions.map((d) => (
            <div class="decision" key={d.id}>
              <p class="decision-title">
                <code>{d.id}</code> {d.title}
              </p>
              <p>
                We chose {lowerFirst(d.chosen)}. {d.why}
              </p>
              {d.rejected.map((r) => (
                <p class="rejected" key={r.option}>
                  Not {lowerFirst(r.option)}: {lowerFirst(r.why)}
                </p>
              ))}
              <button class="link full-record" onClick={() => send({ type: 'showDecision', id: d.id })}>
                Full record
              </button>
            </div>
          ))}
          <button class="link ask-more" onClick={() => send({ type: 'askMore', where: entry.where })}>
            Ask more about this line
          </button>
        </article>
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
    case 'choice':
      return <ChoiceCard entry={entry} />;
    case 'idiom':
      return <IdiomCard entry={entry} />;
    case 'level':
      return <LevelChanged entry={entry} />;
    case 'suggestion':
      return <Suggestion entry={entry} />;
    case 'replay':
      return (
        <p class="replay-entry">
          <span class="label">Replay</span> {entry.title} <span class="quiet">· {entry.scenes} scenes</span>{' '}
          <button class="link" onClick={() => send({ type: 'replay', action: 'open', id: entry.replayId })}>
            Watch
          </button>
        </p>
      );
  }
}
