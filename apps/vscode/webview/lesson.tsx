// What a piece teaches, at the user's level in its technology: a card on a new idea, the words of a
// line, the lines of a part, the shape of a line, or a plain list of what to write. Also the cards
// for choices the user makes, the usual way beside their own, and level changes.

import { useState } from 'preact/hooks';
import type { ChoiceOption, JournalEntry, PieceView, Teaching } from '../src/panel/protocol.ts';
import { send } from './vscode.ts';

const KEYS = navigator.userAgent.includes('Macintosh') ? { show: ['Ctrl', 'Alt', 'S'], done: ['⌘', '⌥', 'Enter'] } : { show: ['Alt', 'S'], done: ['Ctrl', 'Alt', 'Enter'] };

export function Keys({ keys }: { keys: string[] }) {
  return (
    <span class="keys">
      {keys.map((k, i) => (
        <span key={k}>
          {i > 0 && '+'}
          <kbd>{k}</kbd>
        </span>
      ))}
    </span>
  );
}

/** "Java 0", on a piece and in the step line, so the user always sees which level is at work. */
export function TechChip({ teach }: { teach?: Teaching }) {
  if (!teach || typeof teach.level !== 'number') return null;
  return (
    <span class="chip tech" title={`Your level in ${teach.techName ?? teach.tech ?? 'this technology'}. Change it on the Levels page.`}>
      {teach.techName ?? teach.tech} {teach.level}
    </span>
  );
}

function Concept({ concept }: { concept: NonNullable<Teaching['concept']> }) {
  return (
    <div class="concept">
      <span class="label">New idea</span>
      <h3>{concept.title}</h3>
      <p>{concept.text}</p>
      {concept.bridge && <p class="bridge">{concept.bridge}</p>}
    </div>
  );
}

function Words({ words, every }: { words: NonNullable<Teaching['words']>; every: boolean }) {
  return (
    <div class="lesson-part">
      <span class="label">{every ? 'This line, word by word' : words.length === 1 ? 'A new word' : 'New words'}</span>
      <ol class={`words ${every ? 'numbered' : ''}`}>
        {words.map((w, i) => (
          <li key={`${i}-${w.text}`}>
            {every && <span class="n">{i + 1}</span>}
            <code>{w.text}</code>
            <span class="meaning">{w.meaning}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Lines({ lines, first }: { lines: NonNullable<Teaching['lines']>; first: boolean }) {
  return (
    <div class="lesson-part">
      <span class="label">{first ? 'Read it first, then type it' : 'Line by line'}</span>
      <ol class="code-lines">
        {lines.map((l, i) => (
          <li key={`${i}-${l.code}`}>
            <code>{l.code}</code>
            <span class="meaning">{l.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function List({ label, items }: { label: string; items: string[] }) {
  return (
    <div class="lesson-part">
      <span class="label">{label}</span>
      <ol class="todo">
        {items.map((item, i) => (
          <li key={`${i}-${item}`}>{item}</li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The lesson for the piece the user is writing now. What it holds depends on the level: the
 * planner only sends what that level needs, so this shows whatever arrived, in reading order.
 */
export function Lesson({ piece }: { piece: PieceView }) {
  const t = piece.teach;
  if (!t) return null;
  const faded = !piece.revealed && t.trace && t.trace !== 'full';
  return (
    <div class="lesson">
      {t.concept && <Concept concept={t.concept} />}
      {t.lines && <Lines lines={t.lines} first={t.level === 1} />}
      {t.words && <Words words={t.words} every={t.level === 0} />}
      {faded && t.trace === 'shape' && (
        <p class="lesson-note">
          You have typed this pattern before, so the names are left for you. Each blank in the editor has a hint. <Keys keys={KEYS.show} /> shows the whole line. It is not a test.
        </p>
      )}
      {faded && t.trace === 'first' && (
        <>
          <p class="lesson-note">The first line is traced. The plain sentences under it say what each line should do.</p>
          {t.outline && <List label="What each line does" items={t.outline} />}
        </>
      )}
      {faded && t.trace === 'none' && (
        <>
          {t.todo && <List label="What to write" items={t.todo} />}
          {t.names && (
            <div class="lesson-part">
              <span class="label">Names to use</span>
              <p class="names">
                {t.names.map((n) => (
                  <code key={n}>{n}</code>
                ))}
              </p>
            </div>
          )}
        </>
      )}
      {piece.revealed && <p class="lesson-note">You asked to see the code. It is traced in full now, and it is still yours to type.</p>}
    </div>
  );
}

/** For a finished piece: the lesson folded away, to look back at what the words meant. */
export function LessonReview({ piece }: { piece: PieceView }) {
  const t = piece.teach;
  if (!t || (!t.concept && !t.words && !t.lines)) return null;
  return (
    <details class="review">
      <summary>{t.words ? 'What the words meant' : t.concept ? t.concept.title : 'Line by line'}</summary>
      {t.concept && <Concept concept={t.concept} />}
      {t.lines && <Lines lines={t.lines} first={false} />}
      {t.words && <Words words={t.words} every={false} />}
    </details>
  );
}

// Cards in the journal -------------------------------------------------------------------------------

type Entry<K extends JournalEntry['kind']> = Extract<JournalEntry, { kind: K }>;

export function ChoiceCard({ entry }: { entry: Entry<'choice'> }) {
  const [pending, setPending] = useState<number | null>(null);
  const chosen = entry.chosen;
  const pick = (i: number, option: ChoiceOption) => {
    if (chosen !== undefined) return;
    if (option.pushback && pending !== i) setPending(i);
    else send({ type: 'choose', id: entry.id, option: i });
  };
  const warned = pending !== null ? entry.options[pending] : null;
  return (
    <section class={`choice ${chosen !== undefined ? 'made' : ''}`}>
      <span class="label">{chosen !== undefined ? 'You chose' : 'Your choice'}</span>
      <h3>{entry.question}</h3>
      <div class="options">
        {entry.options.map((o, i) => (
          <button
            key={o.label}
            class={`option ${chosen === i ? 'picked' : ''} ${chosen !== undefined && chosen !== i ? 'other' : ''} ${pending === i ? 'pending' : ''}`}
            disabled={chosen !== undefined}
            onClick={() => pick(i, o)}
          >
            <span class="option-head">
              <span class="option-label">{o.label}</span>
              {o.pick && <span class="chip pick">Senior's pick</span>}
              {o.risk && <span class="chip risk">{o.risk}</span>}
            </span>
            <span class="option-detail">{o.detail}</span>
          </button>
        ))}
      </div>
      {warned && chosen === undefined && (
        <div class="pushback">
          <p>{warned.pushback}</p>
          <div class="actions">
            <button onClick={() => send({ type: 'choose', id: entry.id, option: pending as number })}>Choose it anyway</button>
            <button class="quiet-button" onClick={() => setPending(null)}>
              Pick again
            </button>
          </div>
        </div>
      )}
      {chosen === undefined && !warned && <p class="quiet">Or tell Senior in your own words in Claude Code.</p>}
    </section>
  );
}

export function IdiomCard({ entry }: { entry: Entry<'idiom'> }) {
  return (
    <section class="idiom">
      <span class="label">How it is usually written</span>
      <div class="side">
        <div class={`version mine ${entry.chosen === 'mine' ? 'kept' : ''}`}>
          <span class="quiet">Yours</span>
          <pre>{entry.mine}</pre>
        </div>
        <div class={`version usual ${entry.chosen === 'usual' ? 'kept' : ''}`}>
          <span class="quiet">The usual way</span>
          <pre>{entry.usual}</pre>
        </div>
      </div>
      <p class="said-text">{entry.why}</p>
      {entry.chosen ? (
        <p class="quiet">{entry.chosen === 'mine' ? 'You kept your version. Senior fits the next pieces to it.' : 'You took the usual way. It is in the file now.'}</p>
      ) : (
        <div class="actions">
          <button onClick={() => send({ type: 'idiom', id: entry.id, choice: 'usual' })}>Take the usual way</button>
          <button class="quiet-button" onClick={() => send({ type: 'idiom', id: entry.id, choice: 'mine' })}>
            Keep mine
          </button>
        </div>
      )}
    </section>
  );
}

export function LevelChanged({ entry }: { entry: Entry<'level'> }) {
  return (
    <article class="said level">
      <span class="label">Level changed</span>
      <p>
        {entry.name} is now {entry.to}
        {entry.from !== null ? `, from ${entry.from}` : ''}. {entry.change}
      </p>
    </article>
  );
}

export function Suggestion({ entry }: { entry: Entry<'suggestion'> }) {
  return (
    <article class="said suggestion">
      <span class="label">A suggestion</span>
      <p>{entry.text}</p>
      {entry.answer ? (
        <p class="quiet">{entry.answer === 'yes' ? `${entry.name} is now ${entry.to}.` : `${entry.name} stays at ${entry.from}. Senior will not ask again this session.`}</p>
      ) : (
        <div class="actions">
          <button onClick={() => send({ type: 'suggestion', id: entry.id, answer: 'yes' })}>
            Move {entry.name} to {entry.to}
          </button>
          <button class="quiet-button" onClick={() => send({ type: 'suggestion', id: entry.id, answer: 'no' })}>
            Stay at {entry.from}
          </button>
        </div>
      )}
      <p class="quiet small">Senior asks at most once a session. Only you change the number.</p>
    </article>
  );
}

export { KEYS };
