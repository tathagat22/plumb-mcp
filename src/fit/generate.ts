/**
 * The "generate" half of the autonomous fit loop.
 *
 * Turns a Plumb Design Spec (PDS) into a single self-contained HTML document
 * that renders pixel-identically to the Figma design, then — given the
 * previous attempt plus measured deltas — returns a corrected document. The
 * loop driver in `src/cli/fit.ts` alternates this with the headless capture +
 * verify engine until the convergence score clears the acceptance bar.
 *
 * Uses the Anthropic Messages API directly over fetch — no SDK dependency, so
 * the package stays lean. BYO key via ANTHROPIC_API_KEY.
 */
import type { Delta } from "../verify";
import type { PdsDocument } from "../pds";

/** Default generator model — fast + cheap enough to run several loop passes. */
export const DEFAULT_FIT_MODEL = "claude-sonnet-4-6";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOKENS = 16000;

/**
 * The generator contract. Two rules are load-bearing for the whole loop:
 *   1. Output ONE raw HTML document, nothing else (so we can serve it as-is).
 *   2. Stamp data-plumb-id="<el>" on every node (so the capture can measure it
 *      and the score can attribute every delta back to a design node).
 */
export const GENERATOR_SYSTEM_PROMPT = `You are Plumb's pixel-fitting code generator. You convert a Plumb Design Spec (PDS) — a compact, normalized JSON description of a Figma node tree — into ONE self-contained HTML document that renders pixel-identically to the design, and you iteratively correct it against measured deltas.

OUTPUT CONTRACT (non-negotiable):
- Output ONE complete HTML document and NOTHING else. No markdown fences, no prose, no explanation. The first characters must be "<!doctype html>".
- Load Tailwind via <script src="https://cdn.tailwindcss.com"></script> in <head>. You may add an inline tailwind.config <script> for custom colors/fonts.
- On EVERY rendered element that corresponds to a PDS node, set data-plumb-id="<el>" using that node's exact \`el\` handle. This is how your output is measured: an element without the correct data-plumb-id cannot be scored, and an unbuilt key node caps the score.
- The root element is the PDS root node, sized to its box (w×h). Render at the design's own dimensions on a plain white (or design-specified) body.

FIDELITY RULES:
- Colors: use the exact hex from the token table (tokens.color, keys like $c1). Node \`fill\` on a non-text node → background-color; \`fill\` on a text node → color; \`stroke\` → border-color. Resolve $-refs through the token table before use.
- Layout: from \`layout\` — flow ("row"|"col") → flex-direction (row|column); gap → gap; pad [t,r,b,l] → padding; justify → justify-content; align → align-items. Honor flex-child sizing: grow → flex-grow; selfAlign (stretch|min|max|center) → align-self; layoutSizing FILL → flex:1 / stretch, HUG → fit-content.
- Typography: tokens.text values look like "600 14px/20 Inter" = weight size/line-height family. Match font-size, font-weight, line-height (as a unitless ratio or px), and use the named family with sensible system fallbacks.
- radius: tokens.radius; the literal "full" → border-radius:9999px. strokeW → border-width (with the stroke color). Reproduce shadows (tokens.shadow), opacity, rotation (transform), and textDecoration.
- Text: use node.chars verbatim as the element's text. Respect textCase (UPPER/LOWER/TITLE) if present.
- Images / icons (node has assetId, or iconHint, or type "vector"): render a correctly-sized placeholder element WITH its data-plumb-id — a div at the node's box with a neutral fill. Do NOT fetch external URLs. If iconHint names a glyph (e.g. "search", "close", "chevron-down"), you may inline a simple SVG of about the right size.

CORRECTION MODE:
- When given PREVIOUS_HTML and DELTAS, return a corrected FULL document. Each delta is { el, kind, expected, actual }: change the element whose data-plumb-id === el so its measured value becomes \`expected\`. Delta kinds include size.w, size.h, layout.gap, pad.top/right/bottom/left, layout.flow, fill, text.color, text.chars, text.size, text.weight, text.lh, text.family, radius, stroke.width, opacity, shadow.missing, flex.grow, flex.selfAlign. Fix exactly the listed deltas and DO NOT regress elements that were already correct. Re-output the entire document.`;

export interface GenerateInput {
  pds: PdsDocument;
  /** Previous attempt — present on correction passes. */
  prevHtml?: string;
  /** Deltas to fix this pass — present on correction passes. */
  deltas?: Delta[];
  model?: string;
  apiKey: string;
  /** Abort signal for cancellation / timeouts. */
  signal?: AbortSignal;
}

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  error?: { type: string; message: string };
}

/** Build the user turn — the PDS, plus prior HTML + deltas on correction passes. */
export function buildUserMessage(input: GenerateInput): string {
  const pdsJson = JSON.stringify(input.pds);
  if (!input.prevHtml || !input.deltas || input.deltas.length === 0) {
    return `PDS:\n${pdsJson}\n\nGenerate the full HTML document now.`;
  }
  const fixes = input.deltas
    .slice(0, 40)
    .map(
      (d) =>
        `- ${d.el} · ${d.kind}: expected ${fmt(d.expected)}, got ${fmt(d.actual)}`,
    )
    .join("\n");
  return (
    `PDS:\n${pdsJson}\n\n` +
    `PREVIOUS_HTML:\n${input.prevHtml}\n\n` +
    `DELTAS (fix exactly these, do not regress what is already correct):\n${fixes}\n\n` +
    `Return the corrected full HTML document.`
  );
}

function fmt(v: string | number | null): string {
  if (v === null) return "—";
  return typeof v === "string" ? `"${v}"` : String(v);
}

/** Strip accidental markdown fences / leading prose the model may have added. */
export function extractHtml(raw: string): string {
  let s = raw.trim();
  const fence = s.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) s = fence[1].trim();
  const start = s.search(/<!doctype html|<html/i);
  if (start > 0) s = s.slice(start);
  return s.trim();
}

/**
 * Generate (or correct) the HTML document for one loop pass. Throws a clear
 * Error on auth / network / empty-response failures so the CLI can report and
 * exit cleanly.
 */
export async function generateHtml(input: GenerateInput): Promise<string> {
  const model = input.model ?? DEFAULT_FIT_MODEL;
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": input.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      system: GENERATOR_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserMessage(input) }],
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
    if (res.status === 401) {
      throw new Error(`Anthropic auth failed (${detail}). Check ANTHROPIC_API_KEY.`);
    }
    throw new Error(`Anthropic request failed — ${detail}.`);
  }

  const body = (await res.json()) as AnthropicResponse;
  const text = (body.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
  const html = extractHtml(text);
  if (!html || !/<html|<!doctype/i.test(html)) {
    throw new Error("Generator returned no usable HTML document.");
  }
  return html;
}
