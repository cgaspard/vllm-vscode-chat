import * as vscode from 'vscode';
import { normalizeServerUrl, vllmRestRoot } from './core/url';

// Re-exported from the pure core module so existing importers keep working
// while the implementation stays unit-testable without vscode.
export { normalizeServerUrl, vllmRestRoot };

export interface ExtensionConfig {
  vllmBaseUrl: string; // OpenAI-compatible base, e.g. http://127.0.0.1:8000/v1
  apiKey: string; // optional bearer token for a secured vLLM server ('' = none)
  opencodePath: string;
  serverPort: number;
  defaultModel: string;
  agent: 'build' | 'plan';
  minContextLength: number;
  // Defaults the model manager pre-fills when launching a local `vllm serve`.
  pythonPath: string;
  vllmPath: string;
  hfPath: string;
  hfToken: string;
  defaultMaxModelLen: number;
  defaultGpuMemoryUtilization: number;
}

export function getConfig(): ExtensionConfig {
  const cfg = vscode.workspace.getConfiguration('vllmCode');
  return {
    vllmBaseUrl: normalizeServerUrl(cfg.get<string>('serverUrl') ?? 'http://127.0.0.1:8000/v1'),
    apiKey: (cfg.get<string>('apiKey') ?? '').trim(),
    opencodePath: (cfg.get<string>('opencodePath') ?? '').trim(),
    serverPort: cfg.get<number>('serverPort') ?? 0,
    defaultModel: (cfg.get<string>('defaultModel') ?? '').trim(),
    agent: (cfg.get<string>('agent') as 'build' | 'plan') ?? 'build',
    minContextLength: cfg.get<number>('minContextLength') ?? 32768,
    pythonPath: (cfg.get<string>('pythonPath') ?? '').trim(),
    vllmPath: (cfg.get<string>('vllmPath') ?? '').trim(),
    hfPath: (cfg.get<string>('hfPath') ?? '').trim(),
    hfToken: (cfg.get<string>('hfToken') ?? '').trim(),
    defaultMaxModelLen: cfg.get<number>('defaultMaxModelLen') ?? 32768,
    defaultGpuMemoryUtilization: cfg.get<number>('defaultGpuMemoryUtilization') ?? 0.9,
  };
}
