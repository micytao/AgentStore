import fs from "node:fs";
import path from "node:path";
import { callProvider, createChatState, runTurn } from "@agentstore/agent-core";
import { appendSkillsFooter } from "@agentstore/shared";
import { loadConfig } from "./config";
import { logError, logInfo, logWarn } from "./log";
import { callTool, connectConfiguredServers, listTools } from "./mcpTools";

/**
 * RUN_MODE=once: the Skills Agent's one-shot draft shape (a `hosted-agent-api`
 * listing without `runtime: generic-chat` — no example ships in the bundled
 * catalog today, but the shape is exercised via Admin → Catalog → onboard a
 * new agent) — same image, same agent-core Skills engine, same mounted
 * config.json as the persistent-chat shape (RUN_MODE unset/"chat"), just
 * exits after exactly one turn instead of serving an HTTP chat endpoint.
 * Replaces the old, Skills-unaware ansible/agent-runner/runner.py.
 *
 * Contract with ansible/provision-agent.yml: the playbook reads this pod's
 * *stdout log* (kubernetes.core.k8s_log) and republishes it verbatim as the
 * `<job_name>-result` ConfigMap's `draft` key — that's what
 * packages/engine-ansible/src/openshift.ts's readResultConfigMap() actually
 * reads. RESULT_FILE is written too, for parity with the retired runner.py
 * and local debugging, but nothing downstream currently reads it back out
 * of the pod.
 */

function resultFilePath(): string {
  return process.env.RESULT_FILE || "/output/draft.txt";
}

function writeResultFile(text: string): void {
  const file = resultFilePath();
  try {
    fs.mkdirSync(path.dirname(file) || ".", { recursive: true });
    fs.writeFileSync(file, text, "utf8");
  } catch (err) {
    logWarn("Could not write RESULT_FILE (not fatal — stdout is the real contract)", {
      file,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function runOnce(): Promise<void> {
  const config = loadConfig();
  const goal = (process.env.GOAL || "").trim();
  const successCriteria = (process.env.SUCCESS_CRITERIA || "").trim();
  const userMessage = successCriteria
    ? `Goal: ${goal || "(none provided)"}\nSuccess criteria: ${successCriteria}`
    : `Goal: ${goal || "(none provided)"}`;

  logInfo("One-shot turn started", {
    listing: config.listingName,
    skills: config.skills.map((s) => s.id),
    mcpServers: config.mcpServers.map((s) => s.id),
  });

  await connectConfiguredServers(config.mcpServers);

  try {
    const state = createChatState();
    const reply = await runTurn(
      {
        callProvider: (opts) => callProvider(config.provider, opts),
        callTool,
      },
      config.introLines,
      config.skills,
      listTools(),
      state,
      userMessage
    );
    // Populated by chatLoop.ts's runTurn() as a side effect of the
    // synthetic load_skill tool — the same progressive-disclosure signal
    // apps/agent-runtime/src/chatPage.ts's chat-window indicator uses.
    const loadedSkills = [...state.activeSkillIds];
    const text = appendSkillsFooter(reply, loadedSkills);
    writeResultFile(text);
    // The actual contract provision-agent.yml relies on: stdout.
    console.log(text);
    logInfo("One-shot turn completed", { listing: config.listingName, skillsUsed: loadedSkills });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError("One-shot turn failed", err, { listing: config.listingName });
    const text = `Draft generation failed: ${message}`;
    writeResultFile(text);
    console.log(text);
    process.exitCode = 1;
  }
}
