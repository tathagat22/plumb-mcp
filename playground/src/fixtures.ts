/**
 * Bundled demo designs — pre-extracted PDS, so a visitor can watch the loop
 * with no Figma token (only their Anthropic key). `referenceHtml` is the
 * ground-truth look shown on the "design" side; the loop consumes `pds` and is
 * scored PDS-vs-built, so the reference is purely for human eyeballing.
 */
import type { PdsDocument } from "../../src/pds";

export interface DemoFixture {
  id: string;
  label: string;
  pds: PdsDocument;
  referenceHtml: string;
}

const welcomeCard = {
  root: "0:1",
  nodes: {
    "0:1": {
      el: "0:1",
      type: "frame",
      name: "Welcome Card",
      box: { x: 0, y: 0, w: 360, h: 172 },
      fill: "$c1",
      radius: "$r1",
      layout: { flow: "col", gap: 16, pad: [24, 24, 24, 24], align: "min" },
      children: ["0:2", "0:3", "0:4"],
    },
    "0:2": {
      el: "0:2",
      type: "text",
      name: "Title",
      box: { x: 24, y: 24, w: 312, h: 28 },
      chars: "Welcome back",
      text: "$t1",
      fill: "$c2",
    },
    "0:3": {
      el: "0:3",
      type: "text",
      name: "Subtitle",
      box: { x: 24, y: 68, w: 312, h: 20 },
      chars: "Sign in to continue to your dashboard",
      text: "$t2",
      fill: "$c3",
    },
    "0:4": {
      el: "0:4",
      type: "frame",
      name: "Button",
      box: { x: 24, y: 104, w: 312, h: 44 },
      fill: "$c4",
      radius: "$r2",
      layout: { flow: "row", gap: 8, pad: [12, 16, 12, 16], justify: "center", align: "center" },
      children: ["0:5"],
    },
    "0:5": {
      el: "0:5",
      type: "text",
      name: "Button Label",
      box: { x: 145, y: 116, w: 70, h: 20 },
      chars: "Continue",
      text: "$t3",
      fill: "$c5",
    },
  },
  tokens: {
    color: { $c1: "#FFFFFF", $c2: "#111827", $c3: "#6B7280", $c4: "#4F46E5", $c5: "#FFFFFF" },
    text: { $t1: "700 22px/28 Inter", $t2: "400 14px/20 Inter", $t3: "600 15px/20 Inter" },
    radius: { $r1: 16, $r2: 8 },
  },
} as unknown as PdsDocument;

const welcomeCardReference = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;font-family:Inter,system-ui,sans-serif;background:#F3F4F6;display:flex;justify-content:center;padding:32px;}
  .card{width:360px;background:#fff;border-radius:16px;padding:24px;display:flex;flex-direction:column;gap:16px;box-sizing:border-box;box-shadow:0 1px 3px rgba(0,0,0,.08);}
  .title{font:700 22px/28px Inter,sans-serif;color:#111827;}
  .sub{font:400 14px/20px Inter,sans-serif;color:#6B7280;}
  .btn{background:#4F46E5;border-radius:8px;padding:12px 16px;display:flex;justify-content:center;align-items:center;}
  .btn span{font:600 15px/20px Inter,sans-serif;color:#fff;}
</style></head><body><div class="card">
  <div class="title">Welcome back</div>
  <div class="sub">Sign in to continue to your dashboard</div>
  <div class="btn"><span>Continue</span></div>
</div></body></html>`;

export const DEMO_FIXTURES: DemoFixture[] = [
  { id: "welcome-card", label: "Welcome card", pds: welcomeCard, referenceHtml: welcomeCardReference },
];
