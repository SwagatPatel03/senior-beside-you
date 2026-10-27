// The project's memory as one page: every decision in the ledger, linked to code or not, and every
// feature plan as a checklist. Pure, with no VS Code in it, so the unit tests run it directly.

import type { Decision, Plan, SessionRecord } from '../../../../plugin/core/index.mjs';
import type { MemoryView, PlanStepStatus, PlanView } from '../panel/protocol.ts';
import { byId, decisionDetail } from './text.ts';

const STEP_STATUSES = new Set<PlanStepStatus>(['pending', 'active', 'done', 'skipped']);

export interface MemoryInput {
  ledger: Decision[];
  plans: Plan[];
  sessions: SessionRecord[];
  /** The project-relative path of the file a decision is stored in. */
  recordFile: (e: Decision) => string;
  /** The project-relative path of a plan's design brief, or null when it has none. */
  brief: (feature: string) => string | null;
}

export function memoryView({ ledger, plans, sessions, recordFile, brief }: MemoryInput): MemoryView {
  const active = ledger.filter((e) => e.status !== 'superseded').sort(byId);
  const replaced = ledger.filter((e) => e.status === 'superseded').sort(byId);
  return {
    decisions: [...active, ...replaced].map((e) => decisionDetail(e, ledger, sessions, recordFile(e))),
    plans: [...plans].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).map((p) => planView(p, ledger, brief(p.feature))),
  };
}

/**
 * A plan names its decisions as written in the design session, such as "D-003 Background work runs
 * through an outbox". The id becomes a link, and the ledger's own title is used when it has one.
 */
export function planDecision(text: string, ledger: Decision[]): { id: string; title: string } {
  const match = /^\s*(D-\d+)\b[\s:.,-]*(.*)$/is.exec(text);
  if (!match) return { id: '', title: text.trim() };
  const entry = ledger.find((e) => e.id.toLowerCase() === match[1].toLowerCase());
  return { id: entry?.id ?? match[1].toUpperCase(), title: entry?.title ?? match[2].trim() };
}

export function planView(p: Plan, ledger: Decision[], brief: string | null): PlanView {
  const steps = (p.steps ?? []).map((s, i) => ({
    id: s.id || `S${i + 1}`,
    title: s.title,
    why: s.why ?? '',
    expect: s.expect ?? '',
    risk: s.risk ?? '',
    files: Array.isArray(s.files) ? s.files.map(String) : [],
    check: s.check ?? '',
    status: STEP_STATUSES.has(s.status) ? s.status : 'pending',
    ...(s.summary ? { summary: s.summary } : {}),
  }));
  return {
    feature: p.feature,
    title: p.title,
    goal: p.goal ?? '',
    done: steps.filter((s) => s.status === 'done' || s.status === 'skipped').length,
    total: steps.length,
    decisions: (p.decisions ?? []).map((d) => planDecision(String(d), ledger)),
    examples: (p.examples ?? []).map(String),
    steps,
    brief,
    updatedAt: p.updatedAt ?? '',
  };
}

/** "6 decisions and 1 plan", counting only the decisions still in force. */
export function memoryCount(m: { decisions: { replacedBy?: string }[]; plans: unknown[] }): string {
  const active = m.decisions.filter((d) => !d.replacedBy).length;
  const parts = [`${active} ${active === 1 ? 'decision' : 'decisions'}`];
  if (m.plans.length) parts.push(`${m.plans.length} ${m.plans.length === 1 ? 'plan' : 'plans'}`);
  return parts.join(' and ');
}
