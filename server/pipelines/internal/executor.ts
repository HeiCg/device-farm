import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type pino from 'pino';
import { interpolateVariables } from './variables.js';

export interface StageResult {
  status: 'passed' | 'failed';
  logs: string;
  error?: string;
  durationMs: number;
}

export interface ExecuteScriptOpts {
  script: string;
  workDir: string;
  variables: Record<string, string>;
  timeoutMs: number;
  onLog: (line: string) => void;
  signal?: AbortSignal;
}

export class PipelineExecutor {
  private readonly logger: pino.Logger;

  constructor(logger: pino.Logger) {
    this.logger = logger.child({ component: 'pipeline-executor' });
  }

  evaluateCondition(when: 'success' | 'failure' | 'always', hasFailures: boolean): boolean {
    if (when === 'always') return true;
    if (when === 'failure') return hasFailures;
    return !hasFailures;
  }

  async executeScript(opts: ExecuteScriptOpts): Promise<StageResult> {
    const { workDir, variables, timeoutMs, onLog, signal } = opts;
    const script = interpolateVariables(opts.script, variables);

    const startTime = Date.now();
    const logLines: string[] = [];

    return new Promise<StageResult>((resolve) => {
      const child = spawn('bash', ['-e', '-c', script], {
        cwd: workDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ...Object.fromEntries(
            Object.entries(variables).map(([k, v]) => [`DEVICE_FARM_${k.toUpperCase()}`, v]),
          ),
        },
      });

      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5000);
      }, timeoutMs);

      if (signal) {
        const onAbort = () => { child.kill('SIGTERM'); };
        signal.addEventListener('abort', onAbort, { once: true });
        child.on('exit', () => signal.removeEventListener('abort', onAbort));
      }

      if (child.stdout) {
        const rl = createInterface({ input: child.stdout });
        rl.on('line', (line) => {
          logLines.push(line);
          onLog(line);
        });
      }

      if (child.stderr) {
        const rl = createInterface({ input: child.stderr });
        rl.on('line', (line) => {
          logLines.push(line);
          onLog(line);
        });
      }

      child.on('exit', (exitCode) => {
        clearTimeout(timeout);
        const durationMs = Date.now() - startTime;
        const logs = logLines.join('\n');

        if (timedOut) {
          resolve({ status: 'failed', logs, error: `Script timeout after ${timeoutMs}ms`, durationMs });
        } else if (exitCode !== 0) {
          resolve({ status: 'failed', logs, error: `Script exited with code ${exitCode}`, durationMs });
        } else {
          resolve({ status: 'passed', logs, durationMs });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        resolve({
          status: 'failed',
          logs: logLines.join('\n'),
          error: `Spawn error: ${err.message}`,
          durationMs: Date.now() - startTime,
        });
      });
    });
  }
}
