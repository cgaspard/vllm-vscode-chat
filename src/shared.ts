// Message protocol shared between the extension host and the webview.
import type { MessageWithParts, OpencodeEvent, PermissionResponse } from './opencode/protocol';

export interface UiModel {
  id: string;
  name: string;
  loaded: boolean; // vLLM base models are always resident; LoRA adapters too once loaded
  maxContextLength?: number; // from the server's --max-model-len when reported
  isLora?: boolean;
  parent?: string; // base model id for a LoRA adapter
}

export interface UiSession {
  id: string;
  title: string;
  updated: number;
}

export interface UiServer {
  id: string;
  name: string;
  url: string;
}

// ---- Host -> Webview -----------------------------------------------------
export type HostToWebview =
  | {
      type: 'init';
      models: UiModel[];
      currentModel: string | null;
      agent: 'build' | 'plan';
      cwd: string;
      serverReady: boolean;
      connected: boolean;
      minContext: number;
    }
  | { type: 'models'; models: UiModel[]; currentModel: string | null }
  | { type: 'servers'; servers: UiServer[]; activeId: string; connected: boolean }
  | { type: 'sessions'; sessions: UiSession[]; currentSessionID: string | null }
  | { type: 'sessionLoaded'; sessionID: string; title: string; messages: MessageWithParts[] }
  | { type: 'cleared' }
  | { type: 'event'; event: OpencodeEvent }
  | { type: 'busy'; busy: boolean }
  | { type: 'activeFile'; path: string | null; chars: number }
  | { type: 'status'; text: string; kind?: 'info' | 'warn' | 'error' }
  | { type: 'command'; command: 'history' | 'newChat' | 'focusInput' }
  | { type: 'error'; message: string };

// ---- Webview -> Host -----------------------------------------------------
export interface UiImage {
  mime: string;
  dataUrl: string;
  name?: string;
}

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'send'; text: string; thinking: boolean; images?: UiImage[]; includeActiveFile?: boolean }
  | { type: 'selectModel'; modelID: string }
  | { type: 'refreshModels' }
  | { type: 'openManager' }
  | { type: 'listServers' }
  | { type: 'addServer'; name: string; url: string }
  | { type: 'updateServer'; id: string; name: string; url: string }
  | { type: 'removeServer'; id: string }
  | { type: 'switchServer'; id: string }
  | { type: 'selectAgent'; agent: 'build' | 'plan' }
  | { type: 'newChat' }
  | { type: 'loadSessions' }
  | { type: 'loadSession'; sessionID: string }
  | { type: 'deleteSession'; sessionID: string }
  | { type: 'clearAllSessions' }
  | { type: 'abort' }
  | { type: 'permission'; sessionID: string; permissionID: string; response: PermissionResponse }
  | { type: 'questionReply'; requestID: string; answers: string[][] }
  | { type: 'questionReject'; requestID: string }
  | { type: 'openFile'; path: string }
  | { type: 'retryConnect' };

// ---- Model Manager panel protocol ---------------------------------------
// A separate webview drives local vLLM process management, HF downloads, and
// LoRA adapters. Kept in this shared module so host + webview agree on shapes.

export interface UiInstance {
  id: string;
  label: string;
  model: string;
  baseUrl: string;
  status: 'starting' | 'ready' | 'stopped' | 'error';
  maxModelLen?: number;
  gpuMemoryUtilization?: number;
  enableLora?: boolean;
  error?: string;
}

export interface UiCachedModel {
  repo: string;
  path: string;
}

export interface UiServeForm {
  model: string;
  port: number;
  maxModelLen?: number;
  gpuMemoryUtilization?: number;
  dtype?: string;
  quantization?: string;
  tensorParallelSize?: number;
  enableLora?: boolean;
  apiKey?: string;
}

export type ManagerToWebview =
  | {
      type: 'managerInit';
      canServeLocally: boolean;
      canDownload: boolean;
      vllmPath: string | null;
      hfPath: string | null;
      defaults: { port: number; maxModelLen: number; gpuMemoryUtilization: number };
    }
  | { type: 'instances'; instances: UiInstance[] }
  | { type: 'cached'; models: UiCachedModel[] }
  | { type: 'downloadProgress'; repo: string; line: string }
  | { type: 'downloadDone'; repo: string; error?: string }
  | { type: 'loras'; baseUrl: string; adapters: { id: string; parent?: string }[] }
  | { type: 'managerStatus'; text: string; kind?: 'info' | 'warn' | 'error' };

export type ManagerFromWebview =
  | { type: 'managerReady' }
  | { type: 'refreshInstances' }
  | { type: 'startInstance'; form: UiServeForm }
  | { type: 'stopInstance'; id: string }
  | { type: 'removeInstance'; id: string }
  | { type: 'viewLogs'; id: string }
  | { type: 'refreshCached' }
  | { type: 'download'; repo: string }
  | { type: 'serveCached'; repo: string }
  | { type: 'listLoras'; baseUrl: string }
  | { type: 'loadLora'; baseUrl: string; name: string; path: string }
  | { type: 'unloadLora'; baseUrl: string; name: string };
