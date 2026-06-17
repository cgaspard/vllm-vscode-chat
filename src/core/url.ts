/**
 * vLLM URL helpers. Pure so they can be shared (config, connection registry)
 * and unit-tested without vscode. vLLM exposes an OpenAI-compatible API whose
 * base lives under /v1 (e.g. http://127.0.0.1:8000/v1), so we normalize a
 * user-entered URL to end in /vN, defaulting to /v1.
 */

/**
 * Normalize a user-entered vLLM server URL to the OpenAI-compatible base that
 * ends in /vN (defaulting to /v1): adds a scheme if missing, strips trailing
 * slashes, and appends /v1 when no /vN segment is present. Empty input falls
 * back to the local default.
 */
export function normalizeServerUrl(raw: string, fallback = 'http://127.0.0.1:8000/v1'): string {
  let u = (raw || '').trim().replace(/\/+$/, '');
  if (!u) {
    return fallback;
  }
  if (!/^https?:\/\//i.test(u)) {
    u = 'http://' + u;
  }
  if (!/\/v\d+$/.test(u)) {
    u = u + '/v1';
  }
  return u;
}

/** The vLLM REST root (the OpenAI-compatible base without a trailing /vN). */
export function vllmRestRoot(baseUrl: string): string {
  return (baseUrl || '').replace(/\/v\d+$/, '');
}
