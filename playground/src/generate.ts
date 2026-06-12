/**
 * Browser-side generator. Same contract as the CLI (`src/fit/generate.ts`) —
 * reuses the exact system prompt, user-message builder, and HTML extractor —
 * but calls Anthropic directly from the page with the BYO key and the
 * `anthropic-dangerous-direct-browser-access` header that enables CORS. The
 * key lives only in the visitor's browser; nothing is proxied through a server.
 */
import {
  DEFAULT_FIT_MODEL,
  GENERATOR_SYSTEM_PROMPT,
  buildUserMessage,
  extractHtml,
} from "../../src/fit/generate";
import type { PdsDocument } from "../../src/pds";
import type { Delta } from "../../src/verify";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export interface BrowserGenerateInput {
  pds: PdsDocument;
  prevHtml?: string;
  deltas?: Delta[];
  apiKey: string;
  model?: string;
  signal?: AbortSignal;
}

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  error?: { type: string; message: string };
}

export async function generateBrowserHtml(input: BrowserGenerateInput): Promise<string> {
  const model = input.model ?? DEFAULT_FIT_MODEL;
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": input.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      system: GENERATOR_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: buildUserMessage({
            pds: input.pds,
            prevHtml: input.prevHtml,
            deltas: input.deltas,
            apiKey: input.apiKey,
          }),
        },
      ],
    }),
    signal: input.signal,
  });

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as AnthropicResponse;
      if (body.error) detail = `${body.error.type}: ${body.error.message}`;
    } catch {
      /* keep the status line */
    }
    if (res.status === 401) throw new Error(`Anthropic auth failed (${detail}). Check your API key.`);
    throw new Error(`Anthropic request failed — ${detail}.`);
  }

  const body = (await res.json()) as AnthropicResponse;
  const text = (body.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
  const html = extractHtml(text);
  if (!html || !/<html|<!doctype/i.test(html)) throw new Error("The model returned no usable HTML.");
  return html;
}
