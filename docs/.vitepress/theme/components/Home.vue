<script setup>
import { onMounted, onUnmounted, ref } from "vue";
import { withBase } from "vitepress";
import PlumbBob from "./PlumbBob.vue";

const iterations = [
  { angle: -13, score: 61, note: "shadow offset wrong, radius drifted" },
  { angle: 7, score: 78, note: "flex-child gap off by 4px" },
  { angle: -3, score: 92, note: "one fill-stack z-order swap" },
  { angle: 0, score: 100, note: "pixel-perfect" },
];
// The convergence demo is visitor-driven, not a passive carousel — clicking
// "Run plumb_fit" is what actually mirrors the tool: you run it, it nudges
// the score, you run it again.
const step = ref(0);
function runFit() {
  step.value = (step.value + 1) % iterations.length;
}

const prefersReducedMotion =
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Hero bob: free-swings once on load, then — once settled — tracks the
// cursor with a small live tilt, so "true" is something you can nudge off
// and watch it hunt back for, same as the real verify/fit loop does.
const heroSettled = ref(false);
const heroAngle = ref(0);
function onHeroPointerMove(e) {
  if (!heroSettled.value) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const nx = (e.clientX - rect.left) / rect.width;
  heroAngle.value = (nx - 0.5) * 18;
}
function onHeroPointerLeave() {
  heroAngle.value = 0;
}

const isMobile = ref(
  typeof window !== "undefined" ? window.matchMedia("(max-width: 900px)").matches : false,
);

onMounted(() => {
  if (prefersReducedMotion) {
    step.value = iterations.length - 1;
    heroSettled.value = true;
  }

  const mq = window.matchMedia("(max-width: 900px)");
  const onMqChange = () => {
    isMobile.value = mq.matches;
  };
  mq.addEventListener("change", onMqChange);
  onUnmounted(() => mq.removeEventListener("change", onMqChange));

  document.documentElement.classList.add("ph-reveal-ready");
  const revealEls = document.querySelectorAll("[data-reveal]");
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) entry.target.classList.add("is-in");
      }
    },
    { threshold: 0.15 },
  );
  revealEls.forEach((el) => io.observe(el));
  onUnmounted(() => io.disconnect());
});

const stars = ref(null);
onMounted(async () => {
  try {
    const res = await fetch("https://api.github.com/repos/tathagat22/plumb-mcp");
    if (res.ok) stars.value = (await res.json()).stargazers_count;
  } catch {
    // Silent — the link still works without a count.
  }
});
</script>

<template>
  <div class="plumb-home">
    <nav class="ph-nav">
      <a class="ph-brand" :href="withBase('/')">
        <svg viewBox="0 0 64 64" class="ph-mark" aria-hidden="true">
          <rect width="64" height="64" rx="14" fill="url(#ph-mark-grad)" />
          <path
            d="M20 14 L20 50"
            stroke="white"
            stroke-width="6"
            stroke-linecap="round"
          />
          <circle cx="20" cy="14" r="6" fill="white" />
          <path
            d="M20 32 L44 32 Q50 32 50 38 L50 50"
            stroke="white"
            stroke-width="6"
            stroke-linecap="round"
            stroke-linejoin="round"
            fill="none"
          />
          <circle cx="50" cy="50" r="6" fill="white" />
          <defs>
            <linearGradient id="ph-mark-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#1b2fa6" />
              <stop offset="1" stop-color="#2e6bff" />
            </linearGradient>
          </defs>
        </svg>
        <span>Plumb</span>
      </a>
      <div class="ph-links">
        <a :href="withBase('/getting-started')">Get started</a>
        <a :href="withBase('/tools/')">Tools</a>
        <a :href="withBase('/play/')" target="_self">Playground</a>
        <a
          class="ph-star"
          href="https://github.com/tathagat22/plumb-mcp"
          target="_blank"
          rel="noopener"
          aria-label="Star plumb-mcp on GitHub"
        >
          <svg viewBox="0 0 16 16" class="ph-star-icon" aria-hidden="true">
            <path
              d="M8 .8l2.1 4.6 5 .6-3.7 3.5 1 5.1L8 12l-4.4 2.6 1-5.1L.9 6l5-.6z"
              fill="currentColor"
            />
          </svg>
          <span>{{ stars !== null ? stars.toLocaleString() : "Star" }}</span>
        </a>
      </div>
    </nav>

    <header class="ph-hero" @pointermove="onHeroPointerMove" @pointerleave="onHeroPointerLeave">
      <div class="ph-hero-copy">
        <p class="ph-eyebrow">A two-way Figma MCP</p>
        <h1>
          Design&nbsp;→ code.<br />
          Prompt&nbsp;→ design.<br />
          <span class="ph-accent">Either way, plumb tells you when it's true.</span>
        </h1>
        <p class="ph-lede">
          One direction: Figma in, a normalised design spec out, and a
          verification loop that drives headless Chrome to prove your code
          matches the design. The other: a one-line brief in, a full,
          on-brand Figma page out. No REST rate limits, no metered tool-call
          quotas, no 25k-token cap explosions, no extra API key.
        </p>
        <div class="ph-cta-row">
          <a class="ph-btn ph-btn-brand" :href="withBase('/getting-started')"
            >Get started →</a
          >
          <a class="ph-btn ph-btn-ghost" :href="withBase('/play/')" target="_self"
            >Try the playground</a
          >
        </div>
        <div class="ph-terminal" role="img" aria-label="Terminal: npx plumb-mcp init">
          <div class="ph-terminal-bar">
            <span></span><span></span><span></span>
          </div>
          <pre><code><span class="ph-prompt">$</span> npx plumb-mcp init
<span class="ph-dim">→ found Claude Code, Cursor</span>
<span class="ph-dim">→ wrote .mcp.json (2 servers)</span>
<span class="ph-ok">✓ plumb ready — 22 tools, 0 tokens spent</span></code></pre>
        </div>
      </div>
      <div class="ph-hero-bob" aria-hidden="true">
        <PlumbBob
          :size="isMobile ? 130 : 240"
          :angle="heroSettled ? heroAngle : null"
          @settled="heroSettled = true"
        />
        <p class="ph-hero-bob-hint">move your cursor →</p>
      </div>
    </header>

    <section class="ph-section ph-directions" data-reveal>
      <h2>Two directions, one loop</h2>
      <div class="ph-diptych">
        <article class="ph-flow-card">
          <p class="ph-flow-kicker">Design → code</p>
          <ol class="ph-flow-steps">
            <li>
              <span class="ph-step-n">01</span>
              <div>
                <strong>Extract</strong>
                <p>
                  <code>plumb_outline</code>, <code>plumb_node</code>, or
                  <code>plumb_query</code> pull a Plumb Design Spec — auto-layout
                  pre-resolved to flexbox, tokens deduped to <code>$c1</code>,
                  <code>$t1</code> refs.
                </p>
              </div>
            </li>
            <li>
              <span class="ph-step-n">02</span>
              <div>
                <strong>Build</strong>
                <p>Your agent writes the component from the PDS, same as it always does.</p>
              </div>
            </li>
            <li>
              <span class="ph-step-n">03</span>
              <div>
                <strong>Verify</strong>
                <p>
                  <code>plumb_verify</code> drives headless Chrome and diffs the
                  rendered DOM against the design — layout, color, type, shadow,
                  assets.
                </p>
              </div>
            </li>
            <li>
              <span class="ph-step-n">04</span>
              <div>
                <strong>Fit</strong>
                <p>
                  <code>plumb_fit</code> turns the diff into a 0–100 convergence
                  score and ranked fixes. Fix, re-run, repeat until true.
                </p>
              </div>
            </li>
          </ol>
          <p class="ph-flow-close">Ends true — score 100, pixel-identical.</p>
        </article>

        <article class="ph-flow-card">
          <p class="ph-flow-kicker">Prompt → design</p>
          <ol class="ph-flow-steps">
            <li>
              <span class="ph-step-n">01</span>
              <div>
                <strong>Research + brand</strong>
                <p>
                  The director studies live reference sites, screenshots them,
                  and extracts a palette and type scale from their computed CSS.
                </p>
              </div>
            </li>
            <li>
              <span class="ph-step-n">02</span>
              <div>
                <strong>Compose</strong>
                <p>
                  <code>plumb_studio</code> writes real Figma nodes — nav, hero,
                  features, gallery, CTA, footer — from the brand DSL.
                </p>
              </div>
            </li>
            <li>
              <span class="ph-step-n">03</span>
              <div>
                <strong>Critique</strong>
                <p>
                  <code>plumb_review</code> blends a structural diff, a design
                  rubric, and the agent's own vision verdict into a score and
                  fixes — director, not just generator.
                </p>
              </div>
            </li>
          </ol>
          <p class="ph-flow-close">Ends on your canvas — reviewed, on-brand, ready.</p>
        </article>
      </div>
    </section>

    <section class="ph-section ph-limits" data-reveal>
      <h2>No rate limits, on any plan</h2>
      <p class="ph-section-lede">
        Plumb reads and writes through a companion Figma plugin, not the REST
        API — so none of Figma's Dev Mode MCP or Framelink ceilings apply.
      </p>
      <div class="ph-limits-table">
        <div class="ph-limits-row ph-limits-head">
          <span></span>
          <span>Dev Mode MCP / Framelink</span>
          <span>Plumb</span>
        </div>
        <div class="ph-limits-row">
          <span>REST rate limit</span>
          <span class="ph-bad" data-label="Dev Mode MCP / Framelink">429 on Free/Starter budgets</span>
          <span class="ph-good" data-label="Plumb">none — reads the in-memory doc</span>
        </div>
        <div class="ph-limits-row">
          <span>Tool-call quota</span>
          <span class="ph-bad" data-label="Dev Mode MCP / Framelink">6 calls / month (Starter)</span>
          <span class="ph-good" data-label="Plumb">unmetered</span>
        </div>
        <div class="ph-limits-row">
          <span>Payload size</span>
          <span class="ph-bad" data-label="Dev Mode MCP / Framelink">351,378 tokens on a real screen</span>
          <span class="ph-good" data-label="Plumb">~2.6k tokens for a 178-node dialog</span>
        </div>
        <div class="ph-limits-row">
          <span>Variables</span>
          <span class="ph-bad" data-label="Dev Mode MCP / Framelink">Enterprise-only (REST)</span>
          <span class="ph-good" data-label="Plumb">visible on every plan, incl. Free</span>
        </div>
      </div>
    </section>

    <section class="ph-section ph-loop" data-reveal>
      <div class="ph-loop-copy">
        <h2>Pixel-perfect, or it keeps going</h2>
        <p>
          Every iteration of <code>plumb_verify</code> →
          <code>plumb_fit</code> nudges the render closer to the design.
          The bob only stops swinging when the score hits 100 — same idea,
          same word: <em>plumb</em>, exactly vertical, exactly right.
        </p>
        <p class="ph-loop-note">
          {{ step === iterations.length - 1 ? "true. run it again from the top →" : iterations[step].note }}
        </p>
        <button type="button" class="ph-btn ph-btn-ghost ph-loop-run" @click="runFit">
          Run <code>plumb_fit</code> →
        </button>
      </div>
      <div class="ph-loop-demo">
        <PlumbBob :angle="iterations[step].angle" :size="150" :label="true" />
        <div class="ph-loop-score">
          <span class="ph-score-num">{{ iterations[step].score }}</span>
          <span class="ph-score-max">/100</span>
        </div>
      </div>
    </section>

    <section class="ph-section ph-trust" data-reveal>
      <div class="ph-trust-grid">
        <div class="ph-trust-card">
          <h3>Everything local</h3>
          <p>
            Plugin and server talk over loopback. Nothing about your design
            leaves your machine — the director never calls an external model.
          </p>
        </div>
        <div class="ph-trust-card">
          <h3>Open source</h3>
          <p>
            MIT-licensed. Twenty-two focused tools, plus an offline
            <code>.fig</code> parser. Issues and roadmap on GitHub.
          </p>
        </div>
        <div class="ph-trust-card">
          <h3>Every Figma plan</h3>
          <p>Free, Starter, Professional, Organization, Enterprise — no plan-gating on the plugin path.</p>
        </div>
        <div class="ph-trust-card">
          <h3>No extra key</h3>
          <p>
            Prompt → design runs on the calling agent's own model. No
            network calls, no second API bill.
          </p>
        </div>
      </div>
    </section>

    <footer class="ph-footer" data-reveal>
      <div class="ph-footer-bob"><PlumbBob :size="72" :autoplay="false" :angle="0" /></div>
      <h2>Give it a try, then give it a ⭐</h2>
      <p>Free and MIT-licensed. A star is how other devs find it.</p>
      <div class="ph-cta-row ph-cta-row-center">
        <a class="ph-btn ph-btn-brand" :href="withBase('/getting-started')">Get started →</a>
        <a
          class="ph-btn ph-btn-ghost"
          href="https://github.com/tathagat22/plumb-mcp"
          target="_blank"
          rel="noopener"
          >★ Star on GitHub</a
        >
      </div>
      <p class="ph-footer-fine">
        MIT License · © Tathagat Maitray ·
        <a href="https://www.npmjs.com/package/plumb-mcp" target="_blank" rel="noopener">npm</a>
      </p>
    </footer>
  </div>
</template>

<style src="../home.css"></style>
