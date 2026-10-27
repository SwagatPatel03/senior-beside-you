import { Fragment } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { ActivePiece, Activity, Gear, PanelState, PanelView, Stats } from '../src/panel/protocol.ts';
import { KEYS } from './lesson.tsx';
import { send } from './vscode.ts';

const GEARS: { gear: Gear; label: string; hint: string }[] = [
  { gear: 'type', label: 'Type', hint: 'You write the important lines over the plan, which is traced on every line of the piece.' },
  { gear: 'accept', label: 'Accept', hint: 'The plan is traced on every line of the piece. Tab accepts it while you read why.' },
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

function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** What Claude Code is doing right now, or null when there is nothing to show. */
function activityLine(activity: Activity | null, now: number): string | null {
  if (!activity || now - activity.since > 10 * 60_000) return null;
  const time = now - activity.since >= 3000 ? ` · ${duration(now - activity.since)}` : '';
  if (activity.helper) return activity.state === 'idle' ? 'The navigator has prepared the next step' : `Navigator · ${activity.label ?? 'thinking'}${time}`;
  if (activity.state === 'idle') return null;
  return `${activity.state === 'working' ? (activity.label ?? 'Working') : 'Thinking'}${time}`;
}

function ActivityLine({ activity }: { activity: Activity | null }) {
  const [now, setNow] = useState(Date.now());
  const busy = !!activity && activity.state !== 'idle';
  useEffect(() => {
    setNow(Date.now());
    if (!busy) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [busy, activity?.since]);
  const line = activityLine(activity, now);
  if (!line) return null;
  return (
    <p class={`activity ${busy ? 'busy' : ''}`} role="status" title="What Claude Code is doing right now">
      <span class="dot" aria-hidden="true" />
      {line}
    </p>
  );
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
      <ActivityLine activity={state.activity} />
      {!state.replay && <Pages state={state} />}
      {state.replay ? (
        <div class="step-line replay-line">
          <div class="replay-head">
            <span class="label">Replay</span>
            {state.speech !== false && <ReadAloud on={state.readAloud} />}
            <button class="quiet-button close" title="Close the replay and go back to the session" onClick={() => send({ type: 'replay', action: 'close' })}>
              Close
            </button>
          </div>
          <span class="step-title">{state.replay.title}</span>
        </div>
      ) : (
        state.view === 'session' &&
        state.step && (
          <div class="step-line">
            <span class="label">
              Step {state.step.index} of {state.step.total}
              {state.active?.teach?.techName && typeof state.active.teach.level === 'number' && (
                <span class="step-level">
                  {' '}
                  · {state.active.teach.techName} {state.active.teach.level}
                </span>
              )}
            </span>
            <span class="step-title">{state.step.title}</span>
          </div>
        )
      )}
      {!state.replay && state.view === 'session' && <GearLine state={state} />}
    </header>
  );
}

/**
 * The gears, or, while the user is learning the piece's technology, a line saying they type it
 * themselves: below level 7, accepting or watching a piece would take away the typing that teaches.
 */
function GearLine({ state }: { state: PanelState }) {
  const teach = state.active?.kind === 'spine' ? state.active.teach : undefined;
  if (teach && typeof teach.level === 'number' && teach.level < 7) {
    return (
      <div class="gears learning">
        <span class="gear-note">
          At {teach.techName ?? teach.tech} {teach.level} you type every piece yourself.
        </span>
        {state.speech !== false && <ReadAloud on={state.readAloud} />}
      </div>
    );
  }
  return (
    <div class="gears" role="radiogroup" aria-label="Gear">
      {GEARS.map((g) => (
        <button key={g.gear} role="radio" aria-checked={state.gear === g.gear} class={state.gear === g.gear ? 'gear on' : 'gear'} title={g.hint} onClick={() => send({ type: 'setGear', gear: g.gear })}>
          {g.label}
        </button>
      ))}
      {state.speech !== false && <ReadAloud on={state.readAloud} />}
    </div>
  );
}

/** The pages: this session's journal, everything the project remembers, and the user's levels. */
function Pages({ state }: { state: PanelState }) {
  if (!state.memory && !state.levels && state.view === 'session') return null;
  const decisions = state.memory?.decisions.filter((d) => !d.replacedBy).length ?? 0;
  const plans = state.memory?.plans.length ?? 0;
  const unrated = state.levels?.technologies.filter((t) => t.level === null).length ?? 0;
  const go = (view: PanelView) => send({ type: 'setView', view });
  return (
    <div class="pages" role="tablist" aria-label="Page">
      <button role="tab" aria-selected={state.view === 'session'} class={state.view === 'session' ? 'page on' : 'page'} onClick={() => go('session')} title="What is happening in this session">
        Session
      </button>
      {(state.memory || state.view === 'memory') && (
        <button
          role="tab"
          aria-selected={state.view === 'memory'}
          class={state.view === 'memory' ? 'page on' : 'page'}
          onClick={() => go('memory')}
          title={`Every decision and plan in this project: ${decisions} ${decisions === 1 ? 'decision' : 'decisions'} and ${plans} ${plans === 1 ? 'plan' : 'plans'}`}
        >
          Decisions{decisions > 0 && <span class="count">{decisions}</span>}
        </button>
      )}
      {state.levels && (
        <button
          role="tab"
          aria-selected={state.view === 'levels'}
          class={state.view === 'levels' ? 'page on' : 'page'}
          onClick={() => go('levels')}
          title={unrated ? `${unrated} ${unrated === 1 ? 'technology is' : 'technologies are'} not rated yet` : 'How well you know each technology in this project'}
        >
          Levels{unrated > 0 && <span class="count dot-count" aria-label={`${unrated} not rated`} />}
        </button>
      )}
    </div>
  );
}

function ReadAloud({ on }: { on: boolean }) {
  return (
    <button
      class={`aloud ${on ? 'on' : ''}`}
      title={on ? 'Stop reading the narration aloud' : 'Read the narration aloud with your system voice'}
      aria-pressed={on}
      onClick={() => send({ type: 'toggleReadAloud' })}
    >
      {on ? 'Reading aloud' : 'Read aloud'}
    </button>
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
        {state.levels && state.levels.technologies.length > 0 && (
          <li class={state.levels.technologies.every((t) => t.level !== null) ? 'done' : ''}>
            <span class="label">Your levels</span>
            <span>
              Tell Senior how well you know {state.levels.technologies.slice(0, 3).map((t) => t.name).join(', ')}
              {state.levels.technologies.length > 3 ? ' and the rest' : ''}, so it explains as much as you need and no more.{' '}
              <button class="link" onClick={() => send({ type: 'setView', view: 'levels' })}>
                Open Levels
              </button>
            </span>
          </li>
        )}
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

      {state.replays.length > 0 && (
        <>
          <h2>Replays</h2>
          <p class="quiet">Work done in the fast lane, told as short scenes.</p>
          <ul class="replay-list">
            {state.replays.slice(0, 5).map((r) => (
              <li key={r.id}>
                <button class="link" onClick={() => send({ type: 'replay', action: 'open', id: r.id })}>
                  {r.title}
                </button>
                <span class="quiet">
                  {' '}
                  · {r.scenes} scenes · {new Date(r.createdAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
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
      {active.notice && (
        <p class="active-notice">
          <span class="label">Notice</span> {active.notice}
        </p>
      )}
      <PieceActions active={active} gear={gear} />
    </div>
  );
}

/**
 * What the user can do with the piece in front of them. Below level 7 nothing writes the piece for
 * them: they can ask to see the code of a faded piece, say a piece written from a description is
 * done, or skip it. From level 7, Senior can fill it in as before.
 */
function PieceActions({ active, gear }: { active: ActivePiece; gear: Gear }) {
  const teach = active.teach;
  const learning = active.kind === 'spine' && typeof teach?.level === 'number' && teach.level < 7;
  const faded = !active.revealed && !!teach?.trace && teach.trace !== 'full';
  const own = faded && (teach?.trace === 'first' || teach?.trace === 'none');
  const skip = (
    <button class="quiet-button" onClick={() => send({ type: 'piece', action: 'skip' })}>
      Skip
    </button>
  );

  if (active.diverged) {
    // A faded trace never shows the answer here; the user can ask for it.
    const hidden = !active.diverged.wanted;
    return (
      <div class="divergence">
        <p>Your line differs from the plan.</p>
        <div class="compare">
          <span class="label">You wrote</span>
          <code>{active.diverged.wrote}</code>
          {!hidden && (
            <>
              <span class="label">The plan has</span>
              <code>{active.diverged.wanted}</code>
            </>
          )}
        </div>
        <div class="actions">
          {hidden ? (
            <button onClick={() => send({ type: 'piece', action: 'reveal' })} title={`Trace the whole line. It stays yours to type. (${KEYS.show.join('+')})`}>
              Show me
            </button>
          ) : (
            <button onClick={() => send({ type: 'piece', action: 'showAgain' })}>Show the plan again</button>
          )}
          <button class="quiet-button" onClick={() => send({ type: 'piece', action: 'keepMine' })}>
            Keep mine
          </button>
        </div>
      </div>
    );
  }

  if (learning) {
    const show = KEYS.show.join('+');
    const done = KEYS.done.join('+');
    const hint =
      teach?.trace === 'none' && !active.revealed
        ? `Write it in the editor from the list above. Press Done (${done}) when it is finished, and Senior runs it.`
        : teach?.trace === 'first' && !active.revealed
          ? `Type the first line over the faint text, then write the rest from the sentences under it. Press Done (${done}) when it is finished.`
          : teach?.trace === 'shape' && !active.revealed
            ? `Type over the faint text and fill each blank from its hint. Show me (${show}) traces the whole line.`
            : 'Type it in the editor over the faint text. Ask about any word in the box below.';
    return (
      <>
        <p class="type-hint">{hint}</p>
        <div class="actions">
          {own && (
            <button onClick={() => send({ type: 'piece', action: 'done' })} title={`Finish the piece with what you wrote. Senior checks it by running it. (${done})`}>
              Done
            </button>
          )}
          {faded && (
            <button class={own ? 'quiet-button' : ''} onClick={() => send({ type: 'piece', action: 'reveal' })} title={`Trace the whole piece. It stays yours to type. (${show})`}>
              Show me
            </button>
          )}
          {skip}
        </div>
      </>
    );
  }

  return (
    <div class="actions">
      {active.watching || gear === 'watch' ? (
        <button onClick={() => send({ type: 'piece', action: 'takeOver' })}>Take over</button>
      ) : (
        <button onClick={() => send({ type: 'piece', action: 'fillIn' })} title="Senior writes this piece for you">
          Fill it in
        </button>
      )}
      {skip}
    </div>
  );
}

export function Composer({ placeholder = 'Ask why, or tell Senior something' }: { placeholder?: string }) {
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
        placeholder={placeholder}
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
