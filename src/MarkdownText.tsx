import ReactMarkdown from "react-markdown";

// Scoped deliberately to the model's own reply text (chat bubbles' assistant
// messages, Manage with AI's notes/empty-state text) — not user messages (no
// reason to markdown-parse what someone typed themselves) and not memory/
// tone/Conversation Summary content in the Context panel (that's meant to
// read as literal stored data, not formatted prose). react-markdown renders
// straight to React elements, never dangerouslySetInnerHTML, so this carries
// no injection risk even though the source is an external LLM's raw output.
export function MarkdownText({ text }: { text: string }) {
  return (
    <div className="markdown-text">
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  );
}
