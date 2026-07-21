<script setup>
// The signature visual: Figma and a live webpage normalise into one shared
// semantic design graph, which emits verified React code and Figma designs.
// This replaces a decorative animation with a diagram of what Plumb actually
// does — the architecture described in "Why design engineering platform."
defineProps({
  width: { type: Number, default: 560 },
});
</script>

<template>
  <svg
    class="pg"
    :style="{ maxWidth: `${width}px` }"
    viewBox="0 0 560 260"
    role="img"
    aria-label="Figma and a live website normalise into one shared semantic design graph, which emits verified React code and Figma designs."
  >
    <path class="pg-edge-base" d="M92,70 C180,70 190,120 266,128" />
    <path class="pg-edge-base" d="M92,190 C180,190 190,140 266,132" />
    <path class="pg-edge-base pg-edge-base-out" d="M294,122 C370,100 420,80 468,70" />
    <path class="pg-edge-base pg-edge-base-out" d="M294,138 C370,160 420,180 468,190" />

    <path class="pg-edge-flow pg-edge-flow-in" d="M92,70 C180,70 190,120 266,128" />
    <path class="pg-edge-flow pg-edge-flow-in" d="M92,190 C180,190 190,140 266,132" />
    <path class="pg-edge-flow pg-edge-flow-out" d="M294,122 C370,100 420,80 468,70" />
    <path class="pg-edge-flow pg-edge-flow-out" d="M294,138 C370,160 420,180 468,190" />

    <g class="pg-node">
      <rect x="8" y="50" width="64" height="40" rx="9" class="pg-node-box" />
      <text x="40" y="75" text-anchor="middle" class="pg-node-label">Figma</text>
    </g>
    <g class="pg-node">
      <rect x="8" y="170" width="64" height="40" rx="9" class="pg-node-box" />
      <text x="40" y="195" text-anchor="middle" class="pg-node-label">Web</text>
    </g>

    <g class="pg-hub">
      <circle cx="280" cy="130" r="46" class="pg-hub-ring" />
      <circle cx="280" cy="130" r="52" class="pg-hub-ring pg-hub-ring-2" />
      <g class="pg-hub-graph">
        <line x1="264" y1="120" x2="280" y2="136" />
        <line x1="280" y1="136" x2="296" y2="122" />
        <line x1="280" y1="136" x2="274" y2="150" />
        <line x1="280" y1="136" x2="294" y2="146" />
        <circle cx="264" cy="120" r="3" />
        <circle cx="296" cy="122" r="3" />
        <circle cx="280" cy="136" r="3.5" />
        <circle cx="274" cy="150" r="3" />
        <circle cx="294" cy="146" r="3" />
      </g>
      <text x="280" y="196" text-anchor="middle" class="pg-hub-label">SEMANTIC GRAPH</text>
    </g>

    <g class="pg-node pg-node-out">
      <rect x="478" y="50" width="74" height="40" rx="9" class="pg-node-box" />
      <text x="515" y="75" text-anchor="middle" class="pg-node-label">React code</text>
    </g>
    <g class="pg-node pg-node-out">
      <rect x="478" y="170" width="74" height="40" rx="9" class="pg-node-box" />
      <text x="515" y="195" text-anchor="middle" class="pg-node-label">Figma design</text>
    </g>
  </svg>
</template>

<style scoped>
.pg {
  display: block;
  width: 100%;
  height: auto;
}

.pg-edge-base {
  fill: none;
  stroke: var(--pb-line, #263952);
  stroke-width: 2;
}

.pg-edge-flow {
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-dasharray: 3 11;
  animation: pg-flow 1.8s linear infinite;
}

.pg-edge-flow-in {
  stroke: var(--pb-signal, #2e6bff);
  opacity: 0.9;
}

.pg-edge-flow-out {
  stroke: var(--pb-brass, #c89b5c);
  opacity: 0.9;
  animation-direction: reverse;
}

@keyframes pg-flow {
  to {
    stroke-dashoffset: -28;
  }
}

.pg-node-box {
  fill: var(--pb-panel, #121b2e);
  stroke: var(--pb-line, #263952);
  stroke-width: 1.4;
}

.pg-node-label {
  font-family: var(--pb-mono, monospace);
  font-size: 11px;
  fill: var(--pb-chalk, #eaf0f8);
}

.pg-hub-ring {
  fill: none;
  stroke: var(--pb-signal, #2e6bff);
  stroke-width: 1.4;
  opacity: 0.5;
}

.pg-hub-ring-2 {
  opacity: 0.22;
  animation: pg-pulse 2.6s ease-in-out infinite;
  transform-origin: 280px 130px;
}

@keyframes pg-pulse {
  0%,
  100% {
    r: 52;
    opacity: 0.22;
  }
  50% {
    r: 60;
    opacity: 0.04;
  }
}

.pg-hub-graph line {
  stroke: var(--pb-brass-2, #e6c384);
  stroke-width: 1.6;
  opacity: 0.9;
}

.pg-hub-graph circle {
  fill: var(--pb-brass-2, #e6c384);
}

.pg-hub-label {
  font-family: var(--pb-mono, monospace);
  font-size: 9.5px;
  letter-spacing: 0.1em;
  fill: var(--pb-slate, #8ca0bc);
}

@media (prefers-reduced-motion: reduce) {
  .pg-edge-flow,
  .pg-hub-ring-2 {
    animation: none;
  }
}
</style>
