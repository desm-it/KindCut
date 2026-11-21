import { spawn, type ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

type Pending = {
  id: number;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
const LIMIT = 4 * 1024 * 1024;

/** Private main-process boundary. Never logs argv, stdin, stdout or stderr. */
export class JoyRuntimeClient {
  private child: ChildProcess | null = null;
  private pending: Pending | null = null;
  private closed = false;
  private sequence = 0;
  private buffer = '';
  private retirement: Promise<void> = Promise.resolve();
  constructor(private readonly options: { executable: string; args?: string[] }) {}
  get isRunning() {
    return this.child !== null && this.child.exitCode === null && !this.child.killed;
  }

  private stop(child: ChildProcess) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    // Keep actual-exit evidence after fail() detaches this.child, so host
    // ownership cannot be released while a previous worker is still dying.
    const retired = new Promise<void>((resolve) => child.once('close', () => resolve()));
    this.retirement = Promise.all([this.retirement, retired]).then(() => {});
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch {
      /* Already exited. Never fall back to process-name termination. */
    }
    const force = setTimeout(() => {
      if (child.exitCode === null) {
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch {}
      }
    }, 500);
    force.unref();
    child.once('close', () => clearTimeout(force));
  }
  private fail(message: string) {
    this.closed = true;
    const child = this.child;
    this.child = null;
    this.buffer = '';
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    if (child) this.stop(child);
  }
  private start() {
    const child = spawn(this.options.executable, this.options.args ?? ['--stdio'], {
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    });
    this.child = child;
    const decoder = new StringDecoder('utf8');
    child.on('error', () => {
      if (this.child === child) this.fail('Native Joy runtime unavailable.');
    });
    child.on('close', () => {
      if (this.child === child) this.fail('Native Joy runtime closed.');
    });
    child.stdin?.on('error', () => {
      if (this.child === child) this.fail('Native Joy runtime pipe failed.');
    });
    child.stdout?.on('data', (chunk: Buffer) => {
      if (this.child !== child) return;
      this.buffer += decoder.write(chunk);
      if (Buffer.byteLength(this.buffer) > LIMIT) {
        this.fail('Native Joy response exceeded its limit.');
        return;
      }
      while (this.buffer.includes('\n')) {
        const end = this.buffer.indexOf('\n'),
          line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        const pending = this.pending;
        try {
          const reply = JSON.parse(line) as { id?: unknown; ok?: unknown; result?: unknown };
          if (!pending || !reply || reply.id !== pending.id || typeof reply.ok !== 'boolean')
            throw new Error();
          if (!reply.ok) {
            this.fail('Native Joy rejected the operation.');
            return;
          }
          clearTimeout(pending.timer);
          this.pending = null;
          pending.resolve(reply.result);
        } catch {
          this.fail('Invalid native Joy protocol response.');
          return;
        }
      }
    });
    return child;
  }
  async request(input: Record<string, unknown>, timeoutMs = 5000): Promise<unknown> {
    if (this.closed) throw new Error('Native Joy runtime client is closed.');
    if (this.pending) throw new Error('Native Joy runtime is busy.');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120000)
      throw new Error('Invalid native Joy deadline.');
    const id = ++this.sequence;
    let payload: string;
    try {
      payload = JSON.stringify({ ...input, id }) + '\n';
    } catch {
      throw new Error('Invalid native Joy request.');
    }
    if (Buffer.byteLength(payload) > LIMIT)
      throw new Error('Native Joy request exceeded its limit.');
    const child = this.child ?? this.start();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail('Native Joy deadline exceeded; session discarded.'),
        timeoutMs,
      );
      this.pending = { id, resolve, reject, timer };
      if (!child.stdin?.writable) {
        this.fail('Native Joy input unavailable.');
        return;
      }
      child.stdin.write(payload, (error) => {
        if (error && this.child === child) this.fail('Native Joy runtime pipe failed.');
      });
    });
  }
  abort(): void {
    this.fail('Native Joy runtime client is closed.');
  }
  async close(): Promise<void> {
    this.closed = true;
    const child = this.child;
    this.child = null;
    this.buffer = '';
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Native Joy runtime client is closed.'));
    }
    if (!child) {
      await this.retirement;
      return;
    }
    const retiring = new Promise<void>((resolve) => {
      // EOF gives the worker its bounded owner cancellation/join (up to5s).
      // Escalation still waits for actual process exit before returning.
      const timer = setTimeout(() => {
        this.stop(child);
      }, 6500);
      child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      if (child.exitCode !== null || child.signalCode !== null) {
        clearTimeout(timer);
        resolve();
        return;
      }
      child.stdin?.end();
    });
    this.retirement = Promise.all([this.retirement, retiring]).then(() => {});
    await this.retirement;
  }
}
