"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Renders skill/agent instruction bodies (GitHub-flavored markdown: headings,
 * lists, tables, code, links) with the store's dark-theme typography instead
 * of dumping raw markdown syntax as a wall of plain text. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="store-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
