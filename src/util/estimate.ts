/**
 * Cheap token-count estimate. ~4 characters per token is a good rule of thumb
 * for JSON payloads — accurate enough for the budget meter (plan §7), and it
 * needs no tokenizer dependency.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
