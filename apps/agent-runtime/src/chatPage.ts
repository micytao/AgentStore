/** Chat page — plain HTML/CSS/JS, no build step, no framework, consistent
 * with this app's "small container, few dependencies" goal. Styled to match
 * AgentStore's own dark "aurora + glass" look (apps/web/src/app/globals.css)
 * — same ink background, cyan/violet gradient accents, and glass panels —
 * so a deployed agent's chat page doesn't feel like a different product
 * from the console it was launched from. Talks to POST /api/chat with
 * fetch + credentials so the session cookie round-trips. */
export function chatPageHtml(listingName: string): string {
  const title = escapeHtml(listingName);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0; display: flex; flex-direction: column; min-height: 100vh;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
    letter-spacing: 0.01em;
    color: #f6f7fc; background: #07080f;
  }
  .aurora {
    position: fixed; inset: 0; z-index: 0; pointer-events: none;
    background:
      radial-gradient(900px 480px at 12% -10%, rgba(185, 166, 255, 0.28), transparent 55%),
      radial-gradient(720px 420px at 90% 8%, rgba(124, 240, 212, 0.16), transparent 50%),
      radial-gradient(640px 520px at 70% 100%, rgba(110, 228, 255, 0.12), transparent 55%),
      linear-gradient(180deg, #0a0b16 0%, #07080f 40%);
  }
  .aurora::after {
    content: ""; position: absolute; inset: 0; opacity: 0.06; mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='.35'/%3E%3C/svg%3E");
  }
  header {
    position: relative; z-index: 1; flex: none;
    padding: 1.05rem 1.5rem; display: flex; align-items: center; gap: 0.65rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(7, 8, 15, 0.55);
    backdrop-filter: blur(20px) saturate(1.3);
  }
  header .dot {
    width: 0.55rem; height: 0.55rem; border-radius: 50%; flex: none;
    background: #9af6de; box-shadow: 0 0 10px rgba(154, 246, 222, 0.8);
    animation: pulse 1.8s infinite;
  }
  @keyframes pulse { 70% { box-shadow: 0 0 0 8px rgba(154, 246, 222, 0); } }
  header .title {
    font-weight: 680; font-size: 1.02rem; letter-spacing: -0.01em;
    background: linear-gradient(120deg, #eafff8 0%, #cbbdff 100%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  #log {
    position: relative; z-index: 1; flex: 1; overflow-y: auto;
    padding: 1.6rem 1.5rem; display: flex; flex-direction: column; gap: 0.85rem;
  }
  #log::-webkit-scrollbar { width: 8px; }
  #log::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.12); border-radius: 999px; }
  .empty { margin: auto; color: #8b90ac; font-size: 0.9rem; text-align: center; }
  .msg {
    max-width: 62ch; padding: 0.7rem 1.05rem; line-height: 1.55;
    font-size: 0.92rem; box-shadow: 0 14px 34px rgba(0, 0, 0, 0.22);
  }
  .msg.user {
    align-self: flex-end; color: #08110e; white-space: pre-wrap;
    background: linear-gradient(135deg, #9af6de, #d7fff4);
    border-radius: 1.1rem 1.1rem 0.25rem 1.1rem;
  }
  .msg.assistant {
    align-self: flex-start; color: #eef0f8; max-width: 74ch;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.02));
    border: 1px solid rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(14px);
    border-radius: 1.1rem 1.1rem 1.1rem 0.25rem;
  }
  .msg.pending { opacity: 0.7; }
  .tool-trace { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .tool-trace:not(:empty) { margin-bottom: 0.55rem; }
  .tool-chip {
    display: inline-flex; align-items: center; gap: 0.3rem;
    font-size: 0.72rem; font-weight: 600; letter-spacing: 0.01em;
    color: #b9fbe9; background: rgba(154, 246, 222, 0.1);
    border: 1px solid rgba(154, 246, 222, 0.3);
    border-radius: 999px; padding: 0.2rem 0.65rem;
  }
  /* Rendered-markdown content for assistant replies (headings, lists, code,
     links, etc.) — same palette as apps/web's .store-markdown so a deployed
     agent's answers look consistent with the admin console's skill viewer. */
  .content > :first-child { margin-top: 0; }
  .content > :last-child { margin-bottom: 0; }
  .content h1, .content h2, .content h3, .content h4 {
    color: #fff; font-weight: 650; line-height: 1.3; margin: 0.9rem 0 0.4rem;
  }
  .content h1 { font-size: 1.08rem; }
  .content h2 { font-size: 1rem; padding-bottom: 0.3rem; border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
  .content h3 { font-size: 0.94rem; }
  .content h4 { font-size: 0.92rem; }
  .content p { margin: 0.55rem 0; }
  .content ul, .content ol { margin: 0.45rem 0; padding-left: 1.35rem; display: grid; gap: 0.25rem; }
  .content li { margin: 0; }
  .content a { color: #9af6de; text-decoration: underline; text-decoration-color: rgba(154, 246, 222, 0.4); }
  .content strong { color: #fff; font-weight: 650; }
  .content blockquote {
    margin: 0.55rem 0; padding: 0.25rem 0.85rem;
    border-left: 2px solid rgba(255, 255, 255, 0.2); color: #b7bbd1;
  }
  .content code {
    font-family: "SF Mono", ui-monospace, Menlo, Consolas, monospace;
    font-size: 0.82em; background: rgba(8, 10, 20, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 0.35rem;
    padding: 0.1rem 0.35rem; color: #cdeeff;
  }
  .content pre {
    margin: 0.55rem 0; padding: 0.7rem 0.85rem; border-radius: 0.65rem;
    border: 1px solid rgba(255, 255, 255, 0.1); background: rgba(8, 10, 20, 0.72);
    overflow-x: auto;
  }
  .content pre code { background: transparent; border: 0; padding: 0; color: #e8ebf7; }
  .content hr { margin: 0.9rem 0; border: none; border-top: 1px solid rgba(255, 255, 255, 0.1); }
  form {
    position: relative; z-index: 1; flex: none;
    display: flex; gap: 0.7rem; padding: 1rem 1.5rem 1.3rem;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(7, 8, 15, 0.55);
    backdrop-filter: blur(20px) saturate(1.3);
  }
  textarea {
    flex: 1; resize: none; font: inherit; font-size: 0.92rem;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(8, 10, 20, 0.72); color: #fff;
    border-radius: 0.95rem; padding: 0.75rem 1rem;
    min-height: 46px; max-height: 160px;
  }
  textarea::placeholder { color: #aeb4c9; }
  textarea:focus { outline: 2px solid rgba(124, 240, 212, 0.45); outline-offset: 1px; }
  button {
    border: none; cursor: pointer; font: inherit; font-weight: 650;
    color: #08110e; background: linear-gradient(135deg, #9af6de, #d7fff4);
    padding: 0 1.5rem; border-radius: 999px;
  }
  button:disabled { opacity: 0.45; cursor: default; }
</style>
</head>
<body>
  <div class="aurora"></div>
  <header><span class="dot"></span><span class="title">${title}</span></header>
  <div id="log"><div class="empty">Say hello to get started.</div></div>
  <form id="form">
    <textarea id="input" placeholder="Message ${title}…" rows="1"></textarea>
    <button id="send" type="submit">Send</button>
  </form>
<script>${clientScript}</script>
</body>
</html>`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The chat page's entire client-side behavior, as a `String.raw` template so
 * it can be written as plain, ordinary JavaScript (normal single-backslash
 * regex/string escaping) without the outer HTML template literal silently
 * eating escape sequences — see chatLoop's history of `\n` bugs in this
 * file before this was split out. The only characters that can't appear
 * literally here are a bare backtick (would close this template) and `${`
 * (would be treated as interpolation); the markdown renderer below works
 * around the former with `String.fromCharCode(96)` instead of writing a
 * literal backtick for code-span/fence matching.
 */
const clientScript = String.raw`
  const log = document.getElementById("log");
  const form = document.getElementById("form");
  const input = document.getElementById("input");
  const send = document.getElementById("send");

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // Regexes that need a literal backtick can't be written directly inside
  // this template (a bare backtick would close it), so they're built at
  // runtime from a character code instead.
  const BT = String.fromCharCode(96);
  const FENCE_RE = new RegExp(BT + BT + BT + "([a-zA-Z0-9_-]*)\\n([\\s\\S]*?)(" + BT + BT + BT + "|$)", "g");
  const INLINE_CODE_RE = new RegExp(BT + "([^" + BT + "\\n]+)" + BT, "g");

  function renderInline(text) {
    return text
      .replace(INLINE_CODE_RE, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
      .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>")
      .replace(/(?<![\w_])_([^_\n]+)_(?![\w_])/g, "<em>$1</em>");
  }

  // Small hand-rolled markdown renderer (headings, lists, blockquotes, hr,
  // fenced/inline code, bold/italic, links, paragraphs) — enough for what
  // skill instructions and LLM replies actually use, with no markdown
  // library or CDN script (this page has no build step and no external
  // dependencies by design). Re-parses the *entire* accumulated reply on
  // every streamed delta rather than appending incrementally: replies are
  // short enough that this is cheap, and re-parsing from scratch means a
  // construct that looks broken mid-stream (e.g. an unclosed "**") quietly
  // self-corrects once its closing token arrives.
  function renderMarkdown(raw) {
    const escaped = escapeHtml(raw);
    const codeBlocks = [];
    const withPlaceholders = escaped.replace(FENCE_RE, function (_, lang, code) {
      const token = "\u0000CB" + codeBlocks.length + "\u0000";
      codeBlocks.push("<pre><code>" + code.replace(/\n$/, "") + "</code></pre>");
      return token;
    });

    const blocks = [];
    let para = [];
    let list = null;
    let quote = [];

    function flushPara() {
      if (para.length) {
        blocks.push("<p>" + renderInline(para.join("<br>")) + "</p>");
        para = [];
      }
    }
    function flushList() {
      if (list) {
        const items = list.items.map(function (it) { return "<li>" + renderInline(it) + "</li>"; }).join("");
        blocks.push("<" + list.type + ">" + items + "</" + list.type + ">");
        list = null;
      }
    }
    function flushQuote() {
      if (quote.length) {
        blocks.push("<blockquote>" + renderInline(quote.join("<br>")) + "</blockquote>");
        quote = [];
      }
    }

    const lines = withPlaceholders.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (/^\u0000CB\d+\u0000$/.test(trimmed)) {
        flushPara(); flushList(); flushQuote();
        blocks.push(trimmed);
        continue;
      }
      if (trimmed === "") {
        flushPara(); flushList(); flushQuote();
        continue;
      }
      const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
      if (heading) {
        flushPara(); flushList(); flushQuote();
        const level = heading[1].length;
        blocks.push("<h" + level + ">" + renderInline(heading[2]) + "</h" + level + ">");
        continue;
      }
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        flushPara(); flushList(); flushQuote();
        blocks.push("<hr>");
        continue;
      }
      const quoted = /^&gt;\s?(.*)$/.exec(trimmed);
      if (quoted) {
        flushPara(); flushList();
        quote.push(quoted[1]);
        continue;
      }
      const ul = /^[-*+]\s+(.+)$/.exec(trimmed);
      if (ul) {
        flushPara(); flushQuote();
        if (!list || list.type !== "ul") { flushList(); list = { type: "ul", items: [] }; }
        list.items.push(ul[1]);
        continue;
      }
      const ol = /^\d+[.)]\s+(.+)$/.exec(trimmed);
      if (ol) {
        flushPara(); flushQuote();
        if (!list || list.type !== "ol") { flushList(); list = { type: "ol", items: [] }; }
        list.items.push(ol[1]);
        continue;
      }
      flushList(); flushQuote();
      para.push(trimmed);
    }
    flushPara(); flushList(); flushQuote();

    return blocks.join("").replace(/\u0000CB(\d+)\u0000/g, function (_, idx) { return codeBlocks[Number(idx)]; });
  }

  function addUserMessage(text) {
    const empty = log.querySelector(".empty");
    if (empty) empty.remove();
    const div = document.createElement("div");
    div.className = "msg user";
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }

  function addAssistantMessage() {
    const empty = log.querySelector(".empty");
    if (empty) empty.remove();
    const el = document.createElement("div");
    el.className = "msg assistant pending";
    const trace = document.createElement("div");
    trace.className = "tool-trace";
    const content = document.createElement("div");
    content.className = "content";
    content.textContent = "Thinking…";
    el.appendChild(trace);
    el.appendChild(content);
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return { el: el, trace: trace, content: content };
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    addUserMessage(text);
    const pending = addAssistantMessage();
    send.disabled = true;

    let gotFirstEvent = false;
    let rawText = "";
    const toolNames = [];
    // Some model calls (large context, busy shared endpoints) can take a
    // while before the first token arrives — tick a seconds counter so the
    // bubble visibly changes instead of looking frozen the whole time.
    const startedAt = Date.now();
    const ticker = setInterval(function () {
      if (gotFirstEvent) return;
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      pending.content.textContent = "Thinking… (" + elapsed + "s)";
    }, 1000);

    function renderToolTrace() {
      pending.trace.innerHTML = toolNames
        .map(function (name) { return '<span class="tool-chip">⚙ ' + escapeHtml(name) + "…</span>"; })
        .join("");
    }
    function renderContent() {
      pending.content.innerHTML = renderMarkdown(rawText);
    }

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(function () { return {}; });
        throw new Error(data.error || res.statusText);
      }

      // Server streams newline-delimited JSON events (delta/tool_call/done/
      // error) — read it incrementally so text appears as it's generated
      // instead of only once the whole reply is ready.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalReply = null;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          gotFirstEvent = true;
          if (event.type === "delta") {
            rawText += event.text;
            renderContent();
            log.scrollTop = log.scrollHeight;
          } else if (event.type === "tool_call") {
            toolNames.push(event.name);
            renderToolTrace();
            log.scrollTop = log.scrollHeight;
          } else if (event.type === "done") {
            finalReply = event.reply;
          } else if (event.type === "error") {
            throw new Error(event.error);
          }
        }
      }
      pending.el.classList.remove("pending");
      if (finalReply !== null) {
        rawText = finalReply;
        renderContent();
      }
    } catch (err) {
      pending.el.classList.remove("pending");
      pending.content.textContent = "Error: " + (err && err.message ? err.message : err);
    } finally {
      clearInterval(ticker);
      send.disabled = false;
      input.focus();
    }
  });

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
`;
