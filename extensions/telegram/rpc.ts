import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

interface PendingPrompt {
  resolve: (value: string) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  lastAssistantText: string;
}

interface RpcSessionState {
  sessionFile: string;
  process: ChildProcessWithoutNullStreams;
  buffer: string;
  connected: boolean;
  pending: PendingPrompt | null;
}

function extractAssistantText(message: any): string {
  if (!message || message.role !== "assistant") return "";
  const content = Array.isArray(message.content) ? message.content : [];
  const chunks: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "text" && typeof part.text === "string") chunks.push(part.text);
  }
  return chunks.join("\n").trim();
}

export class TelegramRpcRunner {
  private readonly sessions = new Map<string, RpcSessionState>();

  constructor(private readonly spawnProcess: typeof spawn = spawn) {}

  async runPrompt(sessionFile: string, message: string, timeoutMs = 120_000): Promise<string> {
    const session = this.ensureSession(sessionFile);
    if (session.pending) {
      throw new Error(`RPC session busy for ${sessionFile}`);
    }

    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        session.pending = null;
        reject(new Error(`RPC prompt timed out after ${Math.floor(timeoutMs / 1000)}s`));
      }, timeoutMs);

      session.pending = { resolve, reject, timer, lastAssistantText: "" };
      this.sendCommand(session, { type: "prompt", message });
    });
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      try { session.process.kill("SIGTERM"); } catch {}
      if (session.pending) {
        clearTimeout(session.pending.timer);
        session.pending.reject(new Error("RPC session disposed"));
      }
    }
    this.sessions.clear();
  }

  private ensureSession(sessionFile: string): RpcSessionState {
    const existing = this.sessions.get(sessionFile);
    if (existing && !existing.process.killed) return existing;

    const child = this.spawnProcess("pi", ["--mode", "rpc"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    const state: RpcSessionState = {
      sessionFile,
      process: child,
      buffer: "",
      connected: false,
      pending: null,
    };

    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");

    child.stdout.on("data", (chunk: string) => {
      state.buffer += chunk;
      let idx = state.buffer.indexOf("\n");
      while (idx >= 0) {
        const line = state.buffer.slice(0, idx).trim();
        state.buffer = state.buffer.slice(idx + 1);
        if (line) this.handleLine(state, line);
        idx = state.buffer.indexOf("\n");
      }
    });

    child.stderr.on("data", (chunk: string) => {
      const message = String(chunk || "").trim();
      if (!message) return;
      if (state.pending) {
        clearTimeout(state.pending.timer);
        const { reject } = state.pending;
        state.pending = null;
        reject(new Error(`RPC stderr: ${message}`));
      }
    });

    child.once("exit", (code, signal) => {
      const pending = state.pending;
      state.pending = null;
      if (pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`RPC exited (code=${code ?? "null"}, signal=${signal ?? "null"})`));
      }
      this.sessions.delete(sessionFile);
    });

    this.sessions.set(sessionFile, state);

    this.sendCommand(state, {
      type: "switch_session",
      sessionFile,
      sessionPath: sessionFile,
      path: sessionFile,
    });
    this.sendCommand(state, { type: "get_state" });

    return state;
  }

  private sendCommand(session: RpcSessionState, command: Record<string, unknown>): void {
    if (session.process.stdin.destroyed || !session.process.stdin.writable) {
      throw new Error(`RPC stdin is not writable for ${session.sessionFile}`);
    }
    session.process.stdin.write(JSON.stringify(command) + "\n", "utf-8");
  }

  private handleLine(session: RpcSessionState, line: string): void {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }

    if (!session.connected) session.connected = true;
    if (!session.pending) return;

    if (event.type === "message_end") {
      const maybeText = extractAssistantText(event.message);
      if (maybeText) session.pending.lastAssistantText = maybeText;
      return;
    }

    if (event.type === "agent_end") {
      const pending = session.pending;
      session.pending = null;
      clearTimeout(pending.timer);
      pending.resolve(pending.lastAssistantText || "");
      return;
    }

    if (event.type === "rpc_error" || event.type === "rpc_process_crashed") {
      const pending = session.pending;
      session.pending = null;
      clearTimeout(pending.timer);
      pending.reject(new Error(event.message || "RPC error"));
    }
  }
}
