/**
 * The self-healing loop, browser edition. Identical control flow to the CLI
 * (`src/cli/fit.ts`) — generate → render → verify → score → feed deltas back →
 * repeat to the acceptance bar — but the render half runs in an iframe and the
 * generate half calls Anthropic from the page. Same `verifyAgainst` + `scoreOf`
 * engine as everywhere else.
 */
import { buildFitResponse, type FitResponse } from "../../src/fit";
import { DEFAULT_TOLERANCES, verifyAgainst, type VerifyResult } from "../../src/verify";
import type { PdsDocument } from "../../src/pds";
import { generateBrowserHtml } from "./generate";
import { renderAndCapture } from "./render";

export interface IterationUpdate {
  iteration: number;
  html: string;
  result: VerifyResult;
  fit: FitResponse;
}

export interface RunOptions {
  pds: PdsDocument;
  apiKey: string;
  model?: string;
  iframe: HTMLIFrameElement;
  maxIters?: number;
  accept?: number;
  onIteration: (update: IterationUpdate) => void;
  signal?: AbortSignal;
}

export async function runLoop(opts: RunOptions): Promise<IterationUpdate> {
  const maxIters = opts.maxIters ?? 5;
  let prevHtml: string | undefined;
  let deltas: VerifyResult["deltas"] | undefined;
  let last: IterationUpdate | undefined;

  for (let i = 1; i <= maxIters; i++) {
    if (opts.signal?.aborted) throw new Error("Stopped.");
    const html = await generateBrowserHtml({
      pds: opts.pds,
      prevHtml,
      deltas,
      apiKey: opts.apiKey,
      model: opts.model,
      signal: opts.signal,
    });
    const rendered = await renderAndCapture(opts.iframe, html);
    const result = verifyAgainst(opts.pds, rendered, DEFAULT_TOLERANCES);
    const fit = buildFitResponse(result, { accept: opts.accept, iteration: i });
    last = { iteration: i, html, result, fit };
    opts.onIteration(last);
    prevHtml = html;
    deltas = result.deltas;
    if (fit.done) break;
  }

  if (!last) throw new Error("The loop produced no iterations.");
  return last;
}
