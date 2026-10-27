// The Levels page: how well the user knows each technology in this project, from 0 to 10, and the
// words they have learned so far. A level is a fact about the user that only they know, so Senior
// asks for it and never tests for it.

import type { LevelMeaning, LevelsView } from '../src/panel/protocol.ts';
import { send } from './vscode.ts';

function Scale({ id, name, level, scale }: { id: string; name: string; level: number | null; scale: LevelMeaning[] }) {
  return (
    <div class="scale" role="radiogroup" aria-label={`Your level in ${name}`}>
      {scale.map((m) => (
        <button
          key={m.level}
          role="radio"
          aria-checked={level === m.level}
          class={level === m.level ? 'on' : ''}
          title={`${m.level} · ${m.name}. ${m.anchor}`}
          onClick={() => level !== m.level && send({ type: 'setLevel', tech: id, level: m.level })}
        >
          {m.level}
        </button>
      ))}
    </div>
  );
}

function Row({ id, name, source, level, scale, unrated }: { id: string; name: string; source?: string; level: number | null; scale: LevelMeaning[]; unrated: string }) {
  const meaning = level === null ? null : scale[level];
  return (
    <div class={`level-row ${level === null ? 'unrated' : ''}`}>
      <div class="level-head">
        <span class="level-name">{name}</span>
        {source && <span class="quiet">{source}</span>}
      </div>
      <Scale id={id} name={name} level={level} scale={scale} />
      {meaning ? (
        <p class="level-meaning">
          <strong>
            {meaning.level} · {meaning.name}.
          </strong>{' '}
          {meaning.anchor}
          <span class="level-change">{meaning.change}</span>
        </p>
      ) : (
        <p class="level-meaning">{unrated}</p>
      )}
    </div>
  );
}

export function Levels({ levels }: { levels: LevelsView | null }) {
  if (!levels) {
    return (
      <section class="levels empty">
        <p>Open a project folder to rate the technologies it uses.</p>
      </section>
    );
  }
  const { technologies, scale } = levels;
  return (
    <section class="levels">
      <header class="levels-intro">
        <h1>Your levels</h1>
        <p>Rate each technology from 0 to 10. Senior changes how much you type and how much it explains for each one, from the next piece. Pick the sentence that sounds most like you.</p>
      </header>

      {technologies.length === 0 ? (
        <p class="quiet">Senior has not found any technologies in this project yet. In a new project, the design session chooses them and then asks for your levels.</p>
      ) : (
        technologies.map((t) => (
          <Row
            key={t.id}
            id={t.id}
            name={t.name}
            source={t.found.length ? `found in ${t.found[0].split('/').pop()}` : undefined}
            level={t.level}
            scale={scale}
            unrated="Not rated yet, so Senior works as it always has (level 7). Choose a number when you know where you stand."
          />
        ))
      )}

      {levels.hasCode && (
        <div class="levels-group">
          <Row
            id="codebase"
            name="This codebase"
            source="only this project"
            level={levels.codebase}
            scale={scale}
            unrated="Not rated. This decides how much Senior explains about where things live and which existing pattern a piece copies, not the language itself."
          />
        </div>
      )}

      {levels.elsewhere.length > 0 && (
        <div class="levels-group">
          <h2>Languages you know from elsewhere</h2>
          <p class="quiet">Senior compares new ideas with these when they help.</p>
          {levels.elsewhere.map((t) => (
            <Row key={t.id} id={t.id} name={t.name} level={t.level} scale={scale} unrated="" />
          ))}
        </div>
      )}

      {levels.words.length > 0 && (
        <div class="levels-group">
          <h2>Words you have learned</h2>
          <p class="quiet">Senior explains each word once, and remembers it in every project.</p>
          {levels.words.map((w) => (
            <div class="learned" key={w.id}>
              <span class="level-name">
                {w.name} <span class="quiet">· {w.words.length}</span>
              </span>
              <p class="names">
                {w.words.map((word) => (
                  <code key={word}>{word}</code>
                ))}
              </p>
            </div>
          ))}
        </div>
      )}

      <p class="quiet small">Your levels follow you to every project. This codebase stays with this project. You can also ask Senior to change a level in your coding agent.</p>
    </section>
  );
}
