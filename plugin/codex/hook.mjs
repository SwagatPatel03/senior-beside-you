// One entry point for Codex; the shared hooks continue serving Claude unchanged.
process.env.SENIOR_HOST = 'codex';
const scripts = {
  session: '../hooks/session-start.mjs',
  prompt: '../hooks/on-prompt.mjs',
  tool: '../hooks/on-tool.mjs',
  activity: '../hooks/on-activity.mjs',
};
const script = scripts[process.argv[2]];
if (script) {
  try {
    const mod = await import(script);
    if (process.argv[2] === 'activity') await mod.main();
  } catch {
    // A broken plugin must never break a session.
  }
}
