/**
 * Minimal structured logging for this container's stdout/stderr — the only
 * place an operator can look (`podman logs` / `oc logs`) once this is
 * running as a Deployment with no other observability wired up. Every line
 * is prefixed with a timestamp + level so a `oc logs -f` tail is greppable
 * (`ERROR`, `WARN`), and optional `meta` is appended as JSON so structured
 * fields (session id, duration, tool name, etc.) survive without needing a
 * log-shipping pipeline that understands a custom format.
 *
 * Deliberately not a dependency (pino/winston/etc.) — this app's whole
 * point is staying a tiny, dependency-light container.
 */

type Level = "INFO" | "WARN" | "ERROR";

function line(level: Level, message: string, meta?: Record<string, unknown>): string {
  const suffix = meta && Object.keys(meta).length > 0 ? ` ${safeJson(meta)}` : "";
  return `[agent-runtime] ${new Date().toISOString()} ${level} ${message}${suffix}`;
}

function safeJson(meta: Record<string, unknown>): string {
  try {
    return JSON.stringify(meta);
  } catch {
    return String(meta);
  }
}

export function logInfo(message: string, meta?: Record<string, unknown>): void {
  console.log(line("INFO", message, meta));
}

export function logWarn(message: string, meta?: Record<string, unknown>): void {
  console.warn(line("WARN", message, meta));
}

/** Logs the error's message (and stack, on its own indented lines so it
 * doesn't get lost in the middle of a one-line log) so a failure is
 * diagnosable from `oc logs` alone, without reproducing it locally. */
export function logError(message: string, err: unknown, meta?: Record<string, unknown>): void {
  const errMessage = err instanceof Error ? err.message : String(err);
  console.error(line("ERROR", `${message}: ${errMessage}`, meta));
  if (err instanceof Error && err.stack) console.error(err.stack);
  // providers.ts wraps low-level fetch failures with a friendlier message
  // and keeps the original (often more specific, e.g. "socket hang up" or
  // an undici SystemError with an ECONNRESET code) as `cause` — print that
  // chain too so a container log has the real root cause, not just our
  // own paraphrase of it.
  let cause = err instanceof Error ? err.cause : undefined;
  while (cause instanceof Error) {
    console.error(`  caused by: ${cause.message}`);
    if (cause.stack) console.error(cause.stack);
    cause = cause.cause;
  }
}
