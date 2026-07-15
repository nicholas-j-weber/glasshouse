// §5.4: "A live token count for the full serialized sheet, always visible."
// Neither Anthropic nor this spec mandates a specific client-side
// tokenizer (unlike OpenAI's published tiktoken), so this is a deliberately
// labeled *estimate* — chars/4 is a standard rough approximation for
// English-language BPE tokenization — rather than pulling in a tokenizer
// dependency for a number whose whole purpose (§5.4) is encouraging
// minimalism through visibility, not precise budgeting.
export function estimateTokenCount(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}
