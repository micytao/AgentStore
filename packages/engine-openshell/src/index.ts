import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  EngineAdapter,
  EngineHandle,
  EngineStatus,
  TaskSpec,
} from "@agentstore/shared";

const execFileAsync = promisify(execFile);

function parseSandboxId(stdout: string, fallback: string): string {
  const jsonMatch = stdout.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as {
        id?: string;
        sandboxId?: string;
      };
      if (parsed.id) return parsed.id;
      if (parsed.sandboxId) return parsed.sandboxId;
    } catch {
      /* fall through */
    }
  }
  const idLine = stdout.match(/(?:id|sandbox)[:\s]+([A-Za-z0-9_-]+)/i);
  if (idLine?.[1]) return idLine[1];
  return fallback;
}

async function runOpenshell(args: string[]): Promise<string> {
  const gateway = process.env.OPENSHELL_GATEWAY_URL;
  if (!gateway) {
    throw new Error("OPENSHELL_GATEWAY_URL is not set");
  }

  try {
    const { stdout, stderr } = await execFileAsync("openshell", args, {
      env: {
        ...process.env,
        OPENSHELL_GATEWAY: gateway,
        OPENSHELL_GATEWAY_URL: gateway,
      },
      timeout: 120_000,
    });
    return `${stdout}\n${stderr}`;
  } catch (err) {
    const error = err as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
    };
    if (error.code === "ENOENT") {
      throw new Error(
        "openshell CLI not found on PATH. Install it and set OPENSHELL_GATEWAY_URL, or leave the gateway unset to use the simulated engine."
      );
    }
    throw new Error(
      error.stderr?.trim() ||
        error.stdout?.trim() ||
        error.message ||
        "openshell command failed"
    );
  }
}

export class OpenShellEngineAdapter implements EngineAdapter {
  async provision(spec: TaskSpec): Promise<EngineHandle> {
    const name = `as-${spec.taskId.replace(/-/g, "").slice(0, 12)}`;
    const agent = spec.openshellAgent ?? "claude";
    const extra =
      process.env.OPENSHELL_CREATE_ARGS?.split(" ").filter(Boolean) ?? [];
    const gitArgs = spec.gitUrl ? ["--git-url", spec.gitUrl] : [];
    const output = await runOpenshell([
      "sandbox",
      "create",
      "--name",
      name,
      ...extra,
      ...gitArgs,
      "--",
      agent,
    ]);
    return {
      engineType: "self-hosted-sandbox",
      sandboxId: parseSandboxId(output, name),
    };
  }

  async getStatus(
    handle: EngineHandle,
    _spec: TaskSpec
  ): Promise<EngineStatus> {
    try {
      const output = await runOpenshell(["sandbox", "get", handle.sandboxId]);
      const lower = output.toLowerCase();
      if (lower.includes("fail") || lower.includes("error")) {
        return { phase: "Failed", outputSummary: output.slice(0, 500) };
      }
      if (lower.includes("provision")) {
        return { phase: "Provisioning" };
      }
      return {
        phase: "Running",
        interactive: {
          kind: "openshell",
          attachHint: `openshell sandbox connect ${handle.sandboxId}`,
        },
      };
    } catch (err) {
      return {
        phase: "Failed",
        outputSummary: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async exposeInteractiveEndpoint(handle: EngineHandle) {
    return {
      kind: "openshell" as const,
      url: undefined,
    };
  }

  async terminate(handle: EngineHandle): Promise<void> {
    try {
      await runOpenshell(["sandbox", "delete", handle.sandboxId]);
    } catch {
      await runOpenshell(["sandbox", "rm", handle.sandboxId]).catch(
        () => undefined
      );
    }
  }
}

export const openShellEngine = new OpenShellEngineAdapter();
