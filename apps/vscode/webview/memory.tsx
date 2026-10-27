// The memory page: everything the project keeps in `.senior/`, so nobody has to read the JSON.
// Each plan is a checklist, and each decision opens into its whole record, whether or not any code
// carries it out yet.

import { Fragment } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { DecisionDetail, MemoryView, PlanStepStatus, PlanView } from '../src/panel/protocol.ts';
import { DecisionCard, Part } from './entries.tsx';
import { send } from './vscode.ts';

const STEP_STATUS: Record<PlanStepStatus, { glyph: string; label: string }> = {
  pending: { glyph: '○', label: 'Not started' },
  active: { glyph: '◐', label: 'In progress' },
  done: { glyph: '●', label: 'Done' },
  skipped: { glyph: '–', label: 'Skipped' },
};

const linked = (d: DecisionDetail) => d.files.length > 0 || d.symbols.length > 0;

function clip(text: string, max = 120): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

export function Memory({ memory, focus }: { memory: MemoryView | null; focus: { id: string; n: number } | null }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  /** Unfold a decision and bring it into view, for a link from a plan or from the code. */
  const reveal = (id: string) => {
    setOpen((was) => new Set(was).add(id));
    requestAnimationFrame(() => document.getElementById(`decision-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  };

  useEffect(() => {
    if (focus) reveal(focus.id);
  }, [focus?.n]);

  if (!memory) {
    return (
      <section class="memory empty">
        <p>This folder does not use Senior yet, so it has no decisions or plans to show.</p>
        <p class="quiet">
          Run <code>/senior:onboard</code> in Claude Code to start. In an empty folder it starts a design session, which records the first decisions and a plan.
        </p>
      </section>
    );
  }

  const active = memory.decisions.filter((d) => !d.replacedBy);
  const replaced = memory.decisions.filter((d) => d.replacedBy);
  if (!memory.decisions.length && !memory.plans.length) {
    return (
      <section class="memory empty">
        <p>Nothing is recorded yet.</p>
        <p class="quiet">
          The design session (<code>/senior:design</code>) records the first decisions and a plan, and they appear here as soon as they are saved.
        </p>
      </section>
    );
  }

  const toggle = (id: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const notLinked = active.filter((d) => !linked(d)).length;

  return (
    <section class="memory">
      <p class="memory-lede">
        Everything Senior remembers about this project. It is read from the files in <code>.senior/</code> and updates when they change, so nothing is left out.
      </p>

      {memory.plans.length > 0 && (
        <>
          <h2 class="memory-heading">{memory.plans.length === 1 ? 'The plan' : 'Plans'}</h2>
          {memory.plans.map((p, i) => (
            <PlanCard key={p.feature} plan={p} first={i === 0} onDecision={reveal} />
          ))}
        </>
      )}

      <h2 class="memory-heading">
        Decisions <span class="count">{active.length}</span>
      </h2>
      {notLinked > 0 && (
        <p class="quiet memory-note">
          {notLinked === active.length
            ? 'None of them is linked to code yet. Each one is linked, and shows above its code, when the step that carries it out is built.'
            : `${notLinked} of them ${notLinked === 1 ? 'is' : 'are'} not linked to code yet. ${notLinked === 1 ? 'It is' : 'They are'} linked when the step that carries ${notLinked === 1 ? 'it' : 'them'} out is built.`}
        </p>
      )}
      <ul class="decision-list">
        {active.map((d) => (
          <DecisionRow key={d.id} d={d} open={open.has(d.id)} onToggle={() => toggle(d.id)} onDecision={reveal} />
        ))}
      </ul>

      {replaced.length > 0 && (
        <details class="replaced" open={replaced.some((d) => open.has(d.id))}>
          <summary>
            {replaced.length === 1 ? 'One replaced decision' : `${replaced.length} replaced decisions`}, kept for the history
          </summary>
          <ul class="decision-list">
            {replaced.map((d) => (
              <DecisionRow key={d.id} d={d} open={open.has(d.id)} onToggle={() => toggle(d.id)} onDecision={reveal} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function DecisionRow({ d, open, onToggle, onDecision }: { d: DecisionDetail; open: boolean; onToggle: () => void; onDecision: (id: string) => void }) {
  return (
    <li id={`decision-${d.id}`} class={`decision-item ${open ? 'open' : ''}`}>
      <button class="decision-row" aria-expanded={open} onClick={onToggle} title={open ? 'Fold this decision' : 'Read this decision in full'}>
        <span class="row-head">
          <code>{d.id}</code>
          <span class="chip">{d.undo}</span>
          {d.replacedBy ? <span class="chip old">Replaced by {d.replacedBy}</span> : !linked(d) && <span class="chip">Not in the code yet</span>}
          <span class="fold" aria-hidden="true">
            {open ? '−' : '+'}
          </span>
        </span>
        <span class="row-title">{d.title}</span>
        {!open && <span class="row-chosen">{clip(d.chosen)}</span>}
      </button>
      {open && <DecisionCard d={d} bare onDecision={onDecision} />}
    </li>
  );
}

/** A long path that wraps only after a slash, never in the middle of a name. */
function PathText({ path }: { path: string }) {
  const parts = path.split('/');
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 && (
            <>
              /<wbr />
            </>
          )}
        </Fragment>
      ))}
    </>
  );
}

function PlanCard({ plan, first, onDecision }: { plan: PlanView; first: boolean; onDecision: (id: string) => void }) {
  const next = plan.steps.find((s) => s.status === 'active') ?? plan.steps.find((s) => s.status === 'pending');
  const share = plan.total ? Math.round((plan.done / plan.total) * 100) : 0;
  return (
    <details class="plan-card" open={first}>
      <summary>
        <span class="label">
          {plan.done === plan.total ? 'Finished' : `${plan.done} of ${plan.total} steps done`}
        </span>
        <span class="plan-title">{plan.title}</span>
        <span class="progress" aria-hidden="true">
          <span style={{ width: `${share}%` }} />
        </span>
      </summary>
      {plan.goal && <p class="goal">{plan.goal}</p>}

      <Part label="Steps">
        <ol class="plan-steps">
          {plan.steps.map((s, i) => {
            const isNext = s === next;
            return (
              <li key={s.id} class={`plan-step status-${s.status} ${isNext ? 'next' : ''}`}>
                <details open={isNext}>
                  <summary>
                    <span class="glyph" aria-hidden="true">
                      {STEP_STATUS[s.status].glyph}
                    </span>
                    <span class="step-name">
                      {i + 1}. {s.title}
                    </span>
                    <span class="state">{isNext && s.status === 'pending' ? 'Next' : STEP_STATUS[s.status].label}</span>
                  </summary>
                  <div class="step-body">
                    {s.why && <p>{s.why}</p>}
                    {s.expect && (
                      <p>
                        <span class="label">When it works</span> {s.expect}
                      </p>
                    )}
                    {s.risk && (
                      <p>
                        <span class="label">The risk it guards</span> {s.risk}
                      </p>
                    )}
                    {s.summary && (
                      <p>
                        <span class="label">What was done</span> {s.summary}
                      </p>
                    )}
                    {s.files.length > 0 && (
                      <div class="step-files">
                        <span class="label">{s.files.length === 1 ? 'File' : 'Files'}</span>
                        {s.files.map((f) => (
                          <code key={f}>
                            <PathText path={f} />
                          </code>
                        ))}
                      </div>
                    )}
                    {s.check && (
                      <p class="step-files">
                        <span class="label">Checked by running</span> <code>{s.check}</code>
                      </p>
                    )}
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
      </Part>

      {plan.decisions.length > 0 && (
        <Part label="The decisions it carries out">
          <ul class="plan-decisions">
            {plan.decisions.map((d) => (
              <li key={d.id || d.title}>
                {d.id ? (
                  <button class="link" onClick={() => onDecision(d.id)} title="Read this decision in full">
                    <code>{d.id}</code>
                  </button>
                ) : null}{' '}
                {d.title}
              </li>
            ))}
          </ul>
        </Part>
      )}

      {plan.examples.length > 0 && (
        <Part label="Examples that become the first tests">
          <ul class="plan-examples">
            {plan.examples.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Part>
      )}

      {plan.brief && (
        <p class="plan-brief">
          <button class="link" onClick={() => send({ type: 'openFile', file: plan.brief as string, preview: true })}>
            Read the design brief
          </button>{' '}
          <span class="quiet">It has the questions, the answers and the risks from the design session.</span>
        </p>
      )}
    </details>
  );
}
