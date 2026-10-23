// The replay viewer: one scene at a time, the changes it made, the decisions it carried out, and the
// questions asked about it. The page after the last scene closes with what was skipped and checked.

import type { JournalEntry, ReplayView, SceneKind } from '../src/panel/protocol.ts';
import { Entry } from './entries.tsx';
import { send } from './vscode.ts';

const KIND_LABEL: Record<SceneKind, string> = {
  build: 'Built',
  bug: 'A bug',
  decision: 'A decision',
  skipped: 'Skipped',
  check: 'Checked',
};

export const go = (index: number) => send({ type: 'replay', action: 'go', index });

/** The questions asked about one scene, each followed by its answers. */
function sceneTalk(journal: JournalEntry[], replayId: string, scene: number): JournalEntry[] {
  const out: JournalEntry[] = [];
  for (const q of journal) {
    if (q.kind !== 'question' || q.replay?.id !== replayId || q.replay.scene !== scene) continue;
    out.push(q, ...journal.filter((a) => a.kind === 'answer' && a.replyTo === q.id));
  }
  return out;
}

export function ReplayScene({ replay, journal }: { replay: ReplayView; journal: JournalEntry[] }) {
  const i = replay.index;
  if (i >= replay.scenes.length) return <ReplayEnd replay={replay} />;
  const scene = replay.scenes[i];
  const talk = sceneTalk(journal, replay.id, i);
  return (
    <article class={`scene ${scene.kind}`} key={`${replay.id}-${i}`}>
      {i === 0 && replay.task && (
        <p class="scene-task">
          <span class="label">The task</span> {replay.task}
        </p>
      )}
      <span class="label scene-kind">
        Scene {i + 1} of {replay.scenes.length} · {KIND_LABEL[scene.kind]}
      </span>
      <h2>{scene.title}</h2>
      <p class="scene-narration">{scene.narration}</p>

      {scene.decisions.length > 0 && (
        <div class="scene-block">
          <span class="label">{scene.decisions.length === 1 ? 'The decision behind it' : 'The decisions behind it'}</span>
          <ul class="scene-list">
            {scene.decisions.map((d) => (
              <li key={d.id}>
                <code>{d.id}</code> {d.title ?? ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {scene.files.length > 0 && (
        <div class="scene-block">
          <span class="label">{scene.files.length === 1 ? 'The change' : 'The changes'}</span>
          <ul class="scene-list">
            {scene.files.map((f, k) => (
              <li key={f.path + k}>
                <button class="file link" title="Open the change side by side" onClick={() => send({ type: 'replay', action: 'showChange', file: k })}>
                  {f.path}
                </button>{' '}
                <span class="quiet">{f.change === 'added' ? 'written' : 'changed'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {talk.length > 0 && (
        <div class="scene-talk">
          {talk.map((e) => (
            <Entry key={e.id} entry={e} />
          ))}
        </div>
      )}
    </article>
  );
}

function ReplayEnd({ replay }: { replay: ReplayView }) {
  const nothing = !replay.skipped.length && !replay.verified.length && !replay.notVerified.length;
  return (
    <article class="scene closing">
      <span class="label">After the last scene</span>
      <h2>What was left, and what was checked</h2>
      {replay.skipped.length > 0 && (
        <div class="scene-block">
          <span class="label">Skipped for now</span>
          <ul class="scene-list skipped">
            {replay.skipped.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      {(replay.verified.length > 0 || replay.notVerified.length > 0) && (
        <div class="scene-block summary-lists">
          <span class="label">Checks</span>
          {replay.verified.length > 0 && (
            <ul class="verified">
              {replay.verified.map((v) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
          )}
          {replay.notVerified.length > 0 && (
            <ul class="not-verified">
              {replay.notVerified.map((v) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {nothing && <p class="scene-narration">Nothing was recorded as skipped or checked.</p>}
      <div class="actions">
        <button onClick={() => send({ type: 'replay', action: 'finish' })}>Done</button>
        <button class="quiet-button" onClick={() => go(0)}>
          Watch again
        </button>
      </div>
    </article>
  );
}

export function ReplayNav({ replay }: { replay: ReplayView }) {
  const i = replay.index;
  const n = replay.scenes.length;
  return (
    <nav class="replay-nav" aria-label="Scenes">
      <button onClick={() => go(i - 1)} disabled={i === 0}>
        Back
      </button>
      <div class="ticks">
        {replay.scenes.map((s, k) => (
          <button
            key={k}
            class={`tick ${k === i ? 'on' : k < i ? 'seen' : ''}`}
            title={`Scene ${k + 1}: ${s.title}`}
            aria-label={`Scene ${k + 1}: ${s.title}`}
            aria-current={k === i ? 'step' : undefined}
            onClick={() => go(k)}
          />
        ))}
      </div>
      <button onClick={() => go(i + 1)} disabled={i >= n}>
        {i === n - 1 ? 'Finish' : 'Next'}
      </button>
    </nav>
  );
}
