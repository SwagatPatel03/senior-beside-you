// The one channel from the panel back to the extension.

import type { FromPanel } from '../src/panel/protocol.ts';

interface VsCodeApi {
  postMessage(message: FromPanel): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const api = acquireVsCodeApi();

export function send(message: FromPanel): void {
  api.postMessage(message);
}
