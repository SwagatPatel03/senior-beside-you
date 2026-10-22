import { render } from 'preact';
import { useEffect, useReducer, useRef } from 'preact/hooks';
import type { JournalEntry, PanelState, ToPanel } from '../src/panel/protocol.ts';
import { ActiveBar, Composer, Header, Meter, Welcome } from './chrome.tsx';
import { Entry } from './entries.tsx';
import './styles.css';
import { send } from './vscode.ts';

type Action = ToPanel;

const MAX_ENTRIES = 300;

function reduce(state: PanelState | null, action: Action): PanelState | null {
  switch (action.type) {
    case 'state':
      return action.state;
    case 'entry': {
      if (!state) return state;
      const i = state.journal.findIndex((e) => e.id === action.entry.id);
      const journal: JournalEntry[] = i >= 0 ? state.journal.map((e, k) => (k === i ? action.entry : e)) : [...state.journal, action.entry].slice(-MAX_ENTRIES);
      return { ...state, journal };
    }
    case 'meta':
      return state ? { ...state, gear: action.gear, step: action.step, stats: action.stats, active: action.active, connection: action.connection, readAloud: action.readAloud } : state;
    default:
      return state;
  }
}

function speak(text: string): void {
  if (!('speechSynthesis' in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  window.speechSynthesis.speak(utterance);
}

function App() {
  const [state, dispatch] = useReducer(reduce, null);
  const journalRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const onMessage = (event: MessageEvent<ToPanel>) => {
      if (event.data.type === 'speak') speak(event.data.text);
      else dispatch(event.data);
    };
    window.addEventListener('message', onMessage);
    send({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Follow new entries unless the reader has scrolled up to look at something.
  useEffect(() => {
    const el = journalRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [state?.journal]);

  if (!state) return <div class="loading">Opening Senior…</div>;

  const onScroll = () => {
    const el = journalRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  return (
    <div class="app">
      <Header state={state} />
      <main class="journal" ref={journalRef} onScroll={onScroll} aria-live="polite">
        {state.journal.length === 0 ? <Welcome state={state} /> : state.journal.map((entry) => <Entry key={entry.id} entry={entry} />)}
      </main>
      <footer class="footer">
        {state.active && <ActiveBar active={state.active} gear={state.gear} />}
        <Composer />
        <Meter stats={state.stats} />
      </footer>
    </div>
  );
}

render(<App />, document.getElementById('app') as HTMLElement);
