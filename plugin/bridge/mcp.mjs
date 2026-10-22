// A small MCP server over stdio: newline-delimited JSON-RPC 2.0 on stdin and stdout.
// It covers what the editor bridge needs and nothing more: initialization, listing tools, calling
// tools, ping, and cancellation. Logs go to stderr, because stdout carries the protocol.

import readline from 'node:readline';

const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const PARSE_ERROR = -32700;

/**
 * @param {object} options
 * @param {{ name: string, version: string }} options.info
 * @param {string} [options.instructions]
 * @param {{ name: string, description: string, inputSchema: object }[]} options.tools
 * @param {(name: string, args: object, context: { signal: AbortSignal }) => Promise<object>} options.call
 * @param {NodeJS.ReadableStream} [options.input]
 * @param {NodeJS.WritableStream} [options.output]
 */
export function serveMcp({ info, instructions, tools, call, input = process.stdin, output = process.stdout }) {
  const running = new Map();
  const send = (message) => output.write(`${JSON.stringify(message)}\n`);
  const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

  async function handle(message) {
    const { id, method, params = {} } = message;
    const isRequest = id !== undefined && id !== null;

    switch (method) {
      case 'initialize': {
        const asked = params.protocolVersion;
        const protocolVersion = SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0];
        reply(id, { protocolVersion, capabilities: { tools: {} }, serverInfo: info, ...(instructions ? { instructions } : {}) });
        return;
      }
      case 'ping':
        if (isRequest) reply(id, {});
        return;
      case 'tools/list':
        reply(id, { tools });
        return;
      case 'tools/call': {
        const tool = tools.find((t) => t.name === params.name);
        if (!tool) {
          fail(id, INVALID_PARAMS, `Unknown tool: ${params.name}`);
          return;
        }
        const controller = new AbortController();
        running.set(id, controller);
        try {
          const result = await call(params.name, params.arguments || {}, { signal: controller.signal });
          if (!controller.signal.aborted) reply(id, { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result });
        } catch (err) {
          if (!controller.signal.aborted) reply(id, { content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }], isError: true });
        } finally {
          running.delete(id);
        }
        return;
      }
      case 'notifications/cancelled':
        running.get(params.requestId)?.abort();
        return;
      default:
        // Notifications we do not use (initialized, roots changes) need no answer.
        if (isRequest) fail(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  }

  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  lines.on('line', (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: PARSE_ERROR, message: 'Parse error' } });
      return;
    }
    handle(message).catch((err) => process.stderr.write(`senior-editor: ${err?.stack || err}\n`));
  });
  return { close: () => lines.close() };
}
