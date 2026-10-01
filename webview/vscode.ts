declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

const api = acquireVsCodeApi();

export function post(message: unknown): void {
  api.postMessage(message);
}
