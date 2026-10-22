// Feature plans: the machine-readable side of a design session.
// `.senior/features/<slug>.md` is the brief a person reads; `<slug>.plan.json` is what an engine follows.
// A plan changes only through its step statuses. A new direction is a new decision in the ledger
// and, if the steps change, a new plan saved over the old one by the planner.

import fs from 'node:fs';
import path from 'node:path';
import { readJson, seniorPath, slugify, writeJson } from './paths.mjs';

export const STEP_STATUSES = ['pending', 'active', 'done', 'skipped'];

function featuresDir(root) {
  return seniorPath(root, 'features');
}

export function planPath(root, feature) {
  return path.join(featuresDir(root), `${feature}.plan.json`);
}

export function briefPath(root, feature) {
  return path.join(featuresDir(root), `${feature}.md`);
}

/** Returns a list of problems. An empty list means the plan can be saved. */
export function validatePlan(plan) {
  const problems = [];
  if (!plan || typeof plan !== 'object') return ['The plan must be an object.'];
  for (const field of ['title', 'goal']) {
    if (!plan[field] || typeof plan[field] !== 'string') problems.push(`"${field}" is required and must be text.`);
  }
  if (!Array.isArray(plan.steps) || !plan.steps.length) {
    problems.push('"steps" must be a list with at least one step.');
    return problems;
  }
  plan.steps.forEach((step, i) => {
    for (const field of ['title', 'why', 'expect']) {
      if (!step || typeof step[field] !== 'string' || !step[field].trim()) problems.push(`Step ${i + 1} needs "${field}".`);
    }
    if (step && step.files !== undefined && !Array.isArray(step.files)) problems.push(`Step ${i + 1}: "files" must be a list.`);
  });
  return problems;
}

export function savePlan(root, input, { now = new Date() } = {}) {
  const problems = validatePlan(input);
  if (problems.length) throw new Error(`The plan was not saved:\n- ${problems.join('\n- ')}`);
  const feature = input.feature ? slugify(input.feature) : slugify(input.title);
  const existing = loadPlan(root, feature);
  const plan = {
    feature,
    title: input.title,
    goal: input.goal,
    decisions: Array.isArray(input.decisions) ? input.decisions : [],
    examples: Array.isArray(input.examples) ? input.examples : [],
    steps: input.steps.map((step, i) => ({
      id: step.id || `S${i + 1}`,
      title: step.title,
      why: step.why,
      expect: step.expect,
      risk: step.risk || '',
      files: (step.files || []).map((f) => String(f).replace(/\\/g, '/')),
      check: step.check || '',
      status: STEP_STATUSES.includes(step.status) ? step.status : 'pending',
    })),
    createdAt: existing?.createdAt || now.toISOString(),
    updatedAt: now.toISOString(),
  };
  writeJson(planPath(root, feature), plan);
  return plan;
}

export function loadPlan(root, feature) {
  return readJson(planPath(root, feature), null);
}

export function listPlans(root) {
  const dir = featuresDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.plan.json'))
    .map((f) => readJson(path.join(dir, f), null))
    .filter(Boolean)
    .map((p) => ({
      feature: p.feature,
      title: p.title,
      steps: p.steps.length,
      done: p.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length,
      updatedAt: p.updatedAt,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function setStepStatus(root, feature, stepId, status, { now = new Date(), summary } = {}) {
  if (!STEP_STATUSES.includes(status)) throw new Error(`Unknown step status "${status}".`);
  const plan = loadPlan(root, feature);
  if (!plan) throw new Error(`There is no plan for "${feature}".`);
  const step = plan.steps.find((s) => s.id === stepId);
  if (!step) throw new Error(`The plan for "${feature}" has no step ${stepId}.`);
  step.status = status;
  if (summary) step.summary = summary;
  plan.updatedAt = now.toISOString();
  writeJson(planPath(root, feature), plan);
  return plan;
}

export function nextStep(plan) {
  return plan.steps.find((s) => s.status === 'active') || plan.steps.find((s) => s.status === 'pending') || null;
}

/** The brief a person reads. It is written next to the plan whenever a design session ends. */
export function renderBrief(plan, design = {}) {
  const lines = [`# ${plan.title}`, '', '## Goal', '', plan.goal, ''];
  if (design.answers?.length) {
    lines.push('## Answers', '');
    for (const a of design.answers) lines.push(`- **${a.question}** ${a.answer}`);
    lines.push('');
  }
  if (design.risks?.length) {
    lines.push('## Risks', '');
    design.risks.forEach((r, i) => {
      lines.push(`${i + 1}. **${r.title}**`, `   - What goes wrong: ${r.scene}`, `   - Why it happens: ${r.cause}`, `   - What we decide now: ${r.prevention}${r.regret ? ` (${r.regret})` : ''}`);
    });
    lines.push('');
  }
  const examples = design.examples?.length ? design.examples : plan.examples;
  if (examples?.length) {
    lines.push('## Examples', '');
    for (const e of examples) lines.push(`- ${e}`);
    lines.push('');
  }
  if (plan.decisions?.length) {
    lines.push('## Decisions', '');
    for (const d of plan.decisions) lines.push(`- ${d}`);
    lines.push('');
  }
  lines.push('## Steps', '');
  plan.steps.forEach((s, i) => {
    lines.push(`${i + 1}. **${s.title}**: ${s.why} Expected: ${s.expect}`);
  });
  return `${lines.join('\n')}\n`;
}

export function saveBrief(root, plan, design) {
  const file = briefPath(root, plan.feature);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, renderBrief(plan, design));
  return file;
}
