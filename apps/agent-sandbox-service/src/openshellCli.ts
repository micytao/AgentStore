import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class OpenshellCliError extends Error {}

/**
 * Runs the `openshell` CLI. Unlike the console's old direct-execFile
 * approach, this process's CLI identity is registered once at pod startup
 * (Stage B1 — non-interactive `openshell gateway add`, or a pre-authenticated
 * `~/.config/openshell/` baked in from a mounted Secret), so no
 * per-request gateway URL/token plumbing is needed here.
 */
export async function runOpenshell(
  args: string[],
  opts: { timeoutMs?: number; env?: Record<string, string> } = {}
): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync("openshell", args, {
      timeout: opts.timeoutMs ?? 120_000,
      maxBuffer: 10 * 1024 * 1024,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
    });
    return stdout || stderr;
  } catch (err) {
    const error = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    if (error.code === "ENOENT") {
      throw new OpenshellCliError(
        "openshell CLI not found on PATH inside the Agent Sandbox Service container."
      );
    }
    throw new OpenshellCliError(
      error.stderr?.trim() || error.stdout?.trim() || error.message || "openshell command failed"
    );
  }
}

/** `--output json` is requested throughout; this pulls the JSON object out
 * of stdout even if the CLI also prints human-readable lines around it. */
export function parseJsonOutput<T>(output: string): T | undefined {
  const match = output.match(/\{[\s\S]*\}/);
  if (!match) return undefined;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return undefined;
  }
}
