import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import type { ActivePiece, Gear, PanelState, Stats } from '../src/panel/protocol.ts';
import { send } from './vscode.ts';

const GEARS: { gear: Gear; label: string; hint: string }[] = [
  { gear: 'type', label: 'Type', hint: 'You write the important lines. Ghost text shows the rest of each line.' },
  { gear: 'accept', label: 'Accept', hint: 'The whole piece shows as ghost text. Tab accepts it while you read why.' },
  { gear: 'watch', label: 'Watch', hint: 'Senior types at reading speed. Escape hands it back to you.' },
];

export function Spectacles({ size = 18 }: { size?: number }) {
  return (
    <svg class="mark" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
      <circle cx="6.5" cy="13.5" r="4" />
      <circle cx="17.5" cy="13.5" r="4" />
      <path d="M10.5 13.2c.6-1.1 2.4-1.1 3 0M2.5 13.2 1 9.5M21.5 13.2 23 9.5" />
    </svg>
  );
}

function connectionLabel(state: PanelState): { text: string; live: boolean } {
  const ago = state.connection.lastCallSecondsAgo;
  if (ago !== null && ago < 120) return { text: 'Claude Code is with you', live: true };
  if (ago !== null) return { text: `Claude Code was here ${Math.max(1, Math.round(ago / 60))} min ago`, live: false };
  return { text: 'Waiting for Claude Code', live: false };
}

export function Header({ state }: { state: PanelState }) {
  const connection = connectionLabel(state);
  return (
    <header class="header">
      <div class="masthead">
        <span class="brand">
          <Spectacles />
          <span class="wordmark">Senior</span>
        </span>
        <span class={`presence ${connection.live ? 'live' : ''}`} title={connection.text}>
          <span class="dot" aria-hidden="true" />
          {connection.text}
        </span>
      </div>
      {state.step && (
        <div class="step-line">
          <span class="label">
            Step {state.step.index} of {state.step.total}
          </span>
          <span class="step-title">{state.step.title}</span>
        </div>
      )}
      <div class="gears" role="radiogroup" aria-label="Gear">
        {GEARS.map((g) => (
          <button key={g.gear} role="radio" aria-checked={state.gear === g.gear} class={state.gear === g.gear ? 'gear on' : 'gear'} title={g.hint} onClick={() => send({ type: 'setGear', gear: g.gear })}>
            {g.label}
          </button>
        ))}
        <button
          class={`aloud ${state.readAloud ? 'on' : ''}`}
          title={state.readAloud ? 'Stop reading the narration aloud' : 'Read the narration aloud with your system voice'}
          aria-pressed={state.readAloud}
          onClick={() => send({ type: 'toggleReadAloud' })}
        >
          {state.readAloud ? 'Reading aloud' : 'Read aloud'}
        </button>
      </div>
    </header>
  );
}

const START = '/senior:pair add CSV export for bookings';
const ASK_WHY_KEYS = navigator.userAgent.includes('Macintosh') ? ['⌘', '⌥', '/'] : ['Ctrl', 'Alt', '/'];

function Keys({ keys }: { keys: string[] }) {
  return (
    <span class="keys">
      {keys.map((k, i) => (
        <Fragment key={k}>
          {i > 0 && '+'}
          <kbd>{k}</kbd>
        </Fragment>
      ))}
    </span>
  );
}

export function Welcome({ state }: { state: PanelState }) {
  const { claudeFound, pluginInstalled } = state.connection;
  return (
    <section class="welcome">
      <h1>A senior developer beside you</h1>
      <p class="lede">You write the lines that carry the logic. Senior fills in the boilerplate, explains each decision at the moment it matters, and remembers why, so you can tell the story of your code months later.</p>

      <ol class="setup">
        <li class={claudeFound === true ? 'done' : ''}>
          <span class="label">Claude Code</span>
          {claudeFound === true && <span>Found on this computer.</span>}
          {claudeFound === false && (
            <span>
              Not found. Install Claude Code, then reopen this window.
            </span>
          )}
          {claudeFound === 'unknown' && <span>Checking…</span>}
        </li>
        <li class={pluginInstalled === true ? 'done' : ''}>
          <span class="label">The senior plugin</span>
          {pluginInstalled === true ? (
            <span>Installed in Claude Code.</span>
          ) : (
            <>
              <span>Not installed yet. It adds the pairing skill and connects Claude Code to this editor.</span>
              <button class="setup-button" onClick={() => send({ type: 'setup' })} disabled={claudeFound !== true}>
                Set it up
              </button>
            </>
          )}
        </li>
        <li>
          <span class="label">Start pairing</span>
          <span>
            In Claude Code, run <code>/senior:pair</code> followed by what you want to build.{' '}
            <button class="link" onClick={() => send({ type: 'copy', text: START })}>
              Copy an example
            </button>
          </span>
        </li>
      </ol>

      <h2>Three gears</h2>
      <dl class="gear-notes">
        {GEARS.map((g) => (
          <div key={g.gear}>
            <dt>{g.label}</dt>
            <dd>{g.hint}</dd>
          </div>
        ))}
      </dl>
      <p class="quiet">
        Ask why at any moment: put the cursor on the line you are curious about and press <Keys keys={ASK_WHY_KEYS} />.
      </p>
    </section>
  );
}

export function ActiveBar({ active, gear }: { active: ActivePiece; gear: Gear }) {
  return (
    <div class={`active ${active.diverged ? 'diverged' : ''}`}>
      <div class="active-head">
        <span class="label">
          {active.kind === 'probe' ? 'Probe' : 'Your turn'} · piece {active.index + 1} of {active.total}
        </span>
        <span class="file">{active.file}</span>
      </div>
      <p class="active-why">{active.why}</p>
      {active.diverged ? (
        <div class="divergence">
          <p>Your line differs from the plan.</p>
          <div class="compare">
            <span class="label">You wrote</span>
            <code>{active.diverged.wrote}</code>
            <span class="label">The plan has</span>
            <code>{active.diverged.wanted}</code>
          </div>
          <div class="actions">
            <button onClick={() => send({ type: 'piece', action: 'keepMine' })}>Keep mine</button>
            <button onClick={() => send({ type: 'piece', action: 'showAgain' })}>Show the plan again</button>
          </div>
        </div>
      ) : (
        <div class="actions">
          {active.watching || gear === 'watch' ? (
            <button onClick={() => send({ type: 'piece', action: 'takeOver' })}>Take over</button>
          ) : (
            <button onClick={() => send({ type: 'piece', action: 'fillIn' })} title="Senior writes this piece for you">
              Fill it in
            </button>
          )}
          <button class="quiet-button" onClick={() => send({ type: 'piece', action: 'skip' })}>
            Skip
          </button>
        </div>
      )}
    </div>
  );
}

export function Composer() {
  const [text, setText] = useState('');
  const submit = (event: Event) => {
    event.preventDefault();
    const question = text.trim();
    if (!question) return;
    send({ type: 'ask', text: question });
    setText('');
  };
  return (
    <form class="composer" onSubmit={submit}>
      <input
        aria-label="Ask Senior"
        placeholder="Ask why, or tell Senior something"
        value={text}
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
      />
      <button type="submit" disabled={!text.trim()}>
        Ask
      </button>
    </form>
  );
}

export function Meter({ stats }: { stats: Stats }) {
  const yours = stats.typed;
  const helped = stats.accepted + stats.watched + stats.filled;
  const total = yours + helped;
  if (!total && !stats.takeaways) return <div class="meter quiet">Your lines and Senior's will be counted here.</div>;
  const share = total ? Math.round((yours / total) * 100) : 0;
  return (
    <div class="meter" title={`You wrote ${yours} lines by hand. Senior filled in ${stats.filled}, you accepted ${stats.accepted}, and watched ${stats.watched}.`}>
      <div class="bar" aria-hidden="true">
        <span class="yours" style={{ width: `${share}%` }} />
      </div>
      <span>
        You wrote <strong>{yours}</strong> {yours === 1 ? 'line' : 'lines'} · Senior wrote {helped} · {stats.takeaways} {stats.takeaways === 1 ? 'takeaway' : 'takeaways'}
      </span>
    </div>
  );
}
