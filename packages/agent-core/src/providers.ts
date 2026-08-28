import type {
  ModelMessage,
  ModelResponse,
  ModelTool,
  ModelToolCall,
  ProviderKind,
} from "@agentstore/shared";

/**
 * Per-vendor chat/tool-call calls, extracted verbatim from
 * apps/web/src/server/providers.ts's `callProvider()` so both the console's
 * Autonomous drafting (drafting.ts) and the generic-chat runtime container
 * (apps/agent-runtime) share exactly one implementation. No vendor SDKs —
 * plain `fetch`, same convention the console already followed.
 *
 * This module knows nothing about the vault, provider config storage, or
 * "test connection" (/models listing) — callers resolve those and pass in
 * a plain `ProviderCallConfig`.
 */

export interface ProviderCallConfig {
  kind: ProviderKind;
  baseUrl?: string;
  defaultModel?: string;
  apiKey?: string;
}

/** Self-hosted/shared endpoints (e.g. a workshop vLLM box under load) can sit
 * with an open connection for a long time producing zero bytes, then have an
 * intermediate proxy kill the socket — surfacing as an opaque fetch error
 * only after a minute or more, with no useful message. Bounding every
 * request with our own timeout means callers get a fast, clear error
 * ("... timed out after 90s") instead of an ambiguous hang. */
const DEFAULT_TIMEOUT_MS = 90_000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  label: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    // Every exception `fetch()` itself can throw here is a network-level
    // failure — our own AbortSignal timing out, or the connection being
    // refused/reset/dropped by a flaky self-hosted endpoint or an
    // intermediate proxy. Node/undici's wording for these varies wildly
    // across versions and causes ("terminated", `TypeError: fetch failed`
    // with the real reason one level down in `.cause`, "AbortError", ...),
    // so rather than pattern-matching every message string, treat them all
    // the same: one clear, actionable message with whatever detail is
    // available folded in, and the original error kept as `cause` so the
    // full chain is still visible in the container logs (see log.ts).
    const detail =
      err instanceof Error && err.cause instanceof Error
        ? err.cause.message
        : err instanceof Error
          ? err.message
          : String(err);
    throw new Error(
      `${label} request failed after up to ${Math.round(timeoutMs / 1000)}s (${detail}) — the model endpoint may be overloaded, unreachable, or dropped the connection. Please try again.`,
      { cause: err }
    );
  }
}

export interface CallOptions {
  system: string;
  messages: ModelMessage[];
  tools: ModelTool[];
}

export function defaultBaseUrlFor(kind: ProviderKind): string {
  switch (kind) {
    case "anthropic":
      return "https://api.anthropic.com/v1";
    case "openai":
      return "https://api.openai.com/v1";
    case "gemini":
      return "https://generativelanguage.googleapis.com/v1beta";
    case "openai-compatible":
      return "https://api.openai.com/v1";
  }
}

function fallbackModel(kind: ProviderKind): string {
  switch (kind) {
    case "anthropic":
      return "claude-3-5-sonnet-latest";
    case "openai":
    case "openai-compatible":
      return "gpt-4o-mini";
    case "gemini":
      return "gemini-1.5-flash";
  }
}

/** Real chat/tool-call request against the vendor API for `config.kind`. */
export async function callProvider(config: ProviderCallConfig, opts: CallOptions): Promise<ModelResponse> {
  const base = config.baseUrl || defaultBaseUrlFor(config.kind);
  const model = config.defaultModel || fallbackModel(config.kind);

  switch (config.kind) {
    case "anthropic":
      return callAnthropic(config, base, model, opts);
    case "openai":
    case "openai-compatible":
      return callOpenAiCompatible(config, base, model, opts);
    case "gemini":
      return callGemini(config, base, model, opts);
  }
}

/**
 * Streaming counterpart of `callProvider`, used by apps/agent-runtime so a
 * user watching the chat page sees assistant text appear token-by-token
 * instead of staring at "Thinking…" until the whole reply is ready.
 * `onDelta` fires for each incremental chunk of assistant *text* as it
 * arrives; the resolved `ModelResponse` is the same shape `callProvider`
 * returns (text and/or toolCalls), so chatLoop.ts's tool-hop logic doesn't
 * need to know streaming happened. drafting.ts's one-shot calls have no use
 * for this and keep using plain `callProvider`.
 */
export async function callProviderStream(
  config: ProviderCallConfig,
  opts: CallOptions,
  onDelta: (text: string) => void
): Promise<ModelResponse> {
  const base = config.baseUrl || defaultBaseUrlFor(config.kind);
  const model = config.defaultModel || fallbackModel(config.kind);

  switch (config.kind) {
    case "anthropic":
      return streamAnthropic(config, base, model, opts, onDelta);
    case "openai":
    case "openai-compatible":
      return streamOpenAiCompatible(config, base, model, opts, onDelta);
    case "gemini": {
      // Gemini's streaming endpoint uses a different response framing
      // (streamGenerateContent) that isn't worth the complexity here yet —
      // fetch the full response and flush it as one delta so callers still
      // see a consistent onDelta contract.
      const response = await callGemini(config, base, model, opts);
      if (response.text) onDelta(response.text);
      return response;
    }
  }
}

/** Walks an SSE (`text/event-stream`) response body, calling `onData` with
 * the raw payload of each `data: ...` line (already trimmed, `[DONE]`
 * included verbatim so callers can detect the end-of-stream sentinel). */
async function forEachSseDataLine(
  body: ReadableStream<Uint8Array>,
  onData: (data: string) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line.startsWith("data:")) onData(line.slice(5).trim());
    }
  }
}

async function callAnthropic(
  config: ProviderCallConfig,
  base: string,
  model: string,
  opts: CallOptions
): Promise<ModelResponse> {
  const apiKey = config.apiKey ?? "";
  const body: Record<string, unknown> = {
    model,
    max_tokens: 1024,
    system: opts.system,
    messages: opts.messages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    })),
  };
  if (opts.tools.length > 0) {
    body.tools = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema ?? { type: "object", properties: {} },
    }));
  }

  const res = await fetchWithTimeout(
    `${base}/messages`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    },
    "Anthropic"
  );
  if (!res.ok) throw new Error(`Anthropic /messages failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as {
    content: { type: string; text?: string; name?: string; input?: Record<string, unknown> }[];
  };

  const toolCalls: ModelToolCall[] = [];
  let text = "";
  for (const block of data.content ?? []) {
    if (block.type === "text" && block.text) text += block.text;
    if (block.type === "tool_use" && block.name) {
      const tool = opts.tools.find((t) => t.name === block.name);
      toolCalls.push({ serverId: tool?.serverId ?? "", name: block.name, args: block.input ?? {} });
    }
  }
  return toolCalls.length > 0 ? { toolCalls } : { text };
}

async function callOpenAiCompatible(
  config: ProviderCallConfig,
  base: string,
  model: string,
  opts: CallOptions
): Promise<ModelResponse> {
  const apiKey = config.apiKey;
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: opts.system },
      ...opts.messages.map((m) => ({
        role: m.role === "tool" ? "user" : m.role,
        content: m.content,
      })),
    ],
  };
  if (opts.tools.length > 0) {
    body.tools = opts.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema ?? { type: "object", properties: {} },
      },
    }));
  }

  const res = await fetchWithTimeout(
    `${base}/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    },
    "/chat/completions"
  );
  if (!res.ok) throw new Error(`/chat/completions failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as {
    choices?: {
      message?: {
        content?: string;
        tool_calls?: { function: { name: string; arguments: string } }[];
      };
    }[];
  };
  const message = data.choices?.[0]?.message;
  if (message?.tool_calls?.length) {
    const toolCalls: ModelToolCall[] = message.tool_calls.map((call) => {
      const tool = opts.tools.find((t) => t.name === call.function.name);
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        /* ignore malformed args */
      }
      return { serverId: tool?.serverId ?? "", name: call.function.name, args };
    });
    return { toolCalls };
  }
  return { text: message?.content ?? "" };
}

async function streamOpenAiCompatible(
  config: ProviderCallConfig,
  base: string,
  model: string,
  opts: CallOptions,
  onDelta: (text: string) => void
): Promise<ModelResponse> {
  const apiKey = config.apiKey;
  const body: Record<string, unknown> = {
    model,
    stream: true,
    messages: [
      { role: "system", content: opts.system },
      ...opts.messages.map((m) => ({
        role: m.role === "tool" ? "user" : m.role,
        content: m.content,
      })),
    ],
  };
  if (opts.tools.length > 0) {
    body.tools = opts.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema ?? { type: "object", properties: {} },
      },
    }));
  }

  const res = await fetchWithTimeout(
    `${base}/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    },
    "/chat/completions"
  );
  if (!res.ok || !res.body) throw new Error(`/chat/completions failed: ${res.status} ${await res.text()}`);

  let text = "";
  const toolCallsByIndex = new Map<number, { name: string; serverId: string; argsText: string }>();

  await forEachSseDataLine(res.body, (data) => {
    if (data === "[DONE]") return;
    let parsed: {
      choices?: {
        delta?: {
          content?: string;
          tool_calls?: { index: number; function?: { name?: string; arguments?: string } }[];
        };
      }[];
    };
    try {
      parsed = JSON.parse(data);
    } catch {
      return; // ignore malformed/keep-alive chunks
    }
    const delta = parsed.choices?.[0]?.delta;
    if (delta?.content) {
      text += delta.content;
      onDelta(delta.content);
    }
    for (const call of delta?.tool_calls ?? []) {
      const existing = toolCallsByIndex.get(call.index) ?? { name: "", serverId: "", argsText: "" };
      if (call.function?.name) {
        existing.name = call.function.name;
        existing.serverId = opts.tools.find((t) => t.name === call.function?.name)?.serverId ?? "";
      }
      if (call.function?.arguments) existing.argsText += call.function.arguments;
      toolCallsByIndex.set(call.index, existing);
    }
  });

  if (toolCallsByIndex.size > 0) {
    const toolCalls: ModelToolCall[] = [...toolCallsByIndex.values()].map((call) => {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.argsText || "{}");
      } catch {
        /* ignore malformed args */
      }
      return { serverId: call.serverId, name: call.name, args };
    });
    return { toolCalls };
  }
  return { text };
}

async function streamAnthropic(
  config: ProviderCallConfig,
  base: string,
  model: string,
  opts: CallOptions,
  onDelta: (text: string) => void
): Promise<ModelResponse> {
  const apiKey = config.apiKey ?? "";
  const body: Record<string, unknown> = {
    model,
    max_tokens: 1024,
    stream: true,
    system: opts.system,
    messages: opts.messages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    })),
  };
  if (opts.tools.length > 0) {
    body.tools = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema ?? { type: "object", properties: {} },
    }));
  }

  const res = await fetchWithTimeout(
    `${base}/messages`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    },
    "Anthropic"
  );
  if (!res.ok || !res.body) throw new Error(`Anthropic /messages failed: ${res.status} ${await res.text()}`);

  let text = "";
  const toolCalls: ModelToolCall[] = [];
  let currentToolUse: { name: string; serverId: string; argsText: string } | null = null;

  await forEachSseDataLine(res.body, (data) => {
    let event: {
      type?: string;
      content_block?: { type?: string; name?: string };
      delta?: { type?: string; text?: string; partial_json?: string };
    };
    try {
      event = JSON.parse(data);
    } catch {
      return; // ignore malformed/ping events
    }
    if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
      const name = event.content_block.name ?? "";
      currentToolUse = { name, serverId: opts.tools.find((t) => t.name === name)?.serverId ?? "", argsText: "" };
    } else if (event.type === "content_block_delta") {
      if (event.delta?.type === "text_delta" && event.delta.text) {
        text += event.delta.text;
        onDelta(event.delta.text);
      } else if (event.delta?.type === "input_json_delta" && event.delta.partial_json && currentToolUse) {
        currentToolUse.argsText += event.delta.partial_json;
      }
    } else if (event.type === "content_block_stop" && currentToolUse) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(currentToolUse.argsText || "{}");
      } catch {
        /* ignore malformed args */
      }
      toolCalls.push({ serverId: currentToolUse.serverId, name: currentToolUse.name, args });
      currentToolUse = null;
    }
  });

  return toolCalls.length > 0 ? { toolCalls } : { text };
}

async function callGemini(
  config: ProviderCallConfig,
  base: string,
  model: string,
  opts: CallOptions
): Promise<ModelResponse> {
  const apiKey = config.apiKey ?? "";
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: opts.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
  };
  if (opts.tools.length > 0) {
    body.tools = [
      {
        functionDeclarations: opts.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.inputSchema ?? { type: "object", properties: {} },
        })),
      },
    ];
  }

  const res = await fetchWithTimeout(
    `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    "Gemini"
  );
  if (!res.ok) throw new Error(`Gemini generateContent failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as {
    candidates?: {
      content?: { parts?: { text?: string; functionCall?: { name: string; args: Record<string, unknown> } }[] };
    }[];
  };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const toolCalls: ModelToolCall[] = [];
  let text = "";
  for (const part of parts) {
    if (part.text) text += part.text;
    if (part.functionCall) {
      const tool = opts.tools.find((t) => t.name === part.functionCall!.name);
      toolCalls.push({
        serverId: tool?.serverId ?? "",
        name: part.functionCall.name,
        args: part.functionCall.args ?? {},
      });
    }
  }
  return toolCalls.length > 0 ? { toolCalls } : { text };
}
