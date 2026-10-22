import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * herdr socket API: newline-delimited JSON, one request per connection.
 * Verified against herdr 0.9.5 (protocol 22).
 */

export function socketPath(): string {
  if (process.env.HERDR_SOCKET_PATH) return process.env.HERDR_SOCKET_PATH;
  const config = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  const session = process.env.HERDR_SESSION;
  return session ? join(config, 'herdr', 'sessions', session, 'herdr.sock') : join(config, 'herdr', 'herdr.sock');
}

/** The socket couldn't be reached at all (server not running, socket gone). */
export class ConnectionError extends Error {
  override name = 'ConnectionError';
}

/** The server answered with `{"error": ...}`. */
export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}

export type Request = (method: string, params: Record<string, unknown>) => Promise<unknown>;

let nextId = 0;

export function createClient(path = socketPath(), timeoutMs = 5_000): Request {
  return (method, params) =>
    new Promise((resolve, reject) => {
      const id = `icons_${++nextId}`;
      const socket = createConnection(path);
      let buffer = '';
      let settled = false;
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        fn();
      };
      const timer = setTimeout(() => done(() => reject(new ConnectionError(`${method}: no answer in ${timeoutMs}ms`))), timeoutMs);
      socket.setEncoding('utf8');
      socket.on('connect', () => socket.write(`${JSON.stringify({ id, method, params })}\n`));
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        const end = buffer.indexOf('\n');
        if (end < 0) return;
        done(() => {
          try {
            const msg = JSON.parse(buffer.slice(0, end)) as { result?: unknown; error?: { code?: string; message?: string } };
            if (msg.error) reject(new ApiError(msg.error.code ?? 'error', msg.error.message ?? 'unknown error'));
            else resolve(msg.result);
          } catch (err) {
            reject(err);
          }
        });
      });
      socket.on('error', (err) => done(() => reject(new ConnectionError(`${method}: ${err.message}`))));
      socket.on('close', () => done(() => reject(new ConnectionError(`${method}: connection closed without an answer`))));
    });
}

export interface AgentInfo {
  pane_id: string;
  workspace_id: string;
  agent?: string;
  agent_status: string;
}

export interface WorkspaceInfo {
  workspace_id: string;
  agent_status: string;
}

export async function listAgents(request: Request): Promise<AgentInfo[]> {
  const result = (await request('agent.list', {})) as { agents?: AgentInfo[] };
  return result.agents ?? [];
}

export async function listWorkspaces(request: Request): Promise<WorkspaceInfo[]> {
  const result = (await request('workspace.list', {})) as { workspaces?: WorkspaceInfo[] };
  return result.workspaces ?? [];
}

export type Target = { kind: 'pane'; id: string } | { kind: 'workspace'; id: string };

export interface TokenReport {
  target: Target;
  /** A string sets a token, null clears it; omitted tokens are left alone. */
  tokens: Record<string, string | null>;
  source: string;
  seq: number;
  ttlMs: number;
}

export function reportTokens(request: Request, r: TokenReport): Promise<unknown> {
  const common = { source: r.source, seq: r.seq, tokens: r.tokens, ttl_ms: r.ttlMs };
  return r.target.kind === 'pane'
    ? request('pane.report_metadata', { pane_id: r.target.id, ...common })
    : request('workspace.report_metadata', { workspace_id: r.target.id, ...common });
}
