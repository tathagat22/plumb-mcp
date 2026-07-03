<script setup>
import { ref } from "vue";

// The signature motif: a weighted line that only comes to rest when it is
// exactly vertical — "true". `angle` lets a parent drive the bob directly
// (used by the convergence demo); leave it unset and the bob free-swings
// once on mount, then settles on its own and stays there.
const props = defineProps({
  angle: { type: Number, default: null },
  size: { type: Number, default: 220 },
  autoplay: { type: Boolean, default: true },
  label: { type: Boolean, default: false },
});

const emit = defineEmits(["settled"]);

const settled = ref(props.angle === null ? !props.autoplay : Math.abs(props.angle) < 0.6);

function onAnimationEnd() {
  settled.value = true;
  emit("settled");
}
</script>

<template>
  <svg
    class="plumb-bob"
    :class="{ 'is-settled': settled, 'is-driven': angle !== null }"
    :style="{ width: `${size}px`, height: `${size * (220 / 120)}px` }"
    viewBox="0 0 120 220"
    aria-hidden="true"
  >
    <line x1="60" y1="4" x2="60" y2="212" class="bob-guide" />

    <g
      class="bob-assembly"
      :class="{ 'bob-settle': autoplay && angle === null }"
      :style="angle !== null ? { transform: `rotate(${angle}deg)` } : undefined"
      @animationend="onAnimationEnd"
    >
      <line x1="60" y1="10" x2="60" y2="150" class="bob-string" />
      <circle cx="60" cy="10" r="5" class="bob-anchor" />
      <path
        d="M49 150 C49 150 71 150 71 150 Q74 161 60 200 Q46 161 49 150 Z"
        class="bob-weight"
      />
      <path d="M53 154 Q52 168 58 184" class="bob-sheen" />
    </g>

    <text v-if="label" x="60" y="216" text-anchor="middle" class="bob-label">
      {{ settled ? "TRUE" : "" }}
    </text>
  </svg>
</template>

<style scoped>
.plumb-bob {
  overflow: visible;
  display: block;
}

.bob-guide {
  stroke: var(--pb-line, #2a3c58);
  stroke-width: 1;
  stroke-dasharray: 1 7;
  stroke-linecap: round;
  opacity: 0.6;
}

.bob-assembly {
  transform-origin: 60px 10px;
}

.bob-string {
  stroke: var(--pb-slate, #8ca0bc);
  stroke-width: 2.5;
  stroke-linecap: round;
}

.bob-anchor {
  fill: var(--pb-slate, #8ca0bc);
}

.bob-weight {
  fill: var(--pb-brass, #c89b5c);
}

.bob-sheen {
  fill: none;
  stroke: rgba(255, 255, 255, 0.35);
  stroke-width: 2;
  stroke-linecap: round;
}

.bob-label {
  font-family: var(--pb-mono, "JetBrains Mono", monospace);
  font-size: 11px;
  letter-spacing: 0.16em;
  fill: var(--pb-brass, #c89b5c);
  opacity: 0;
  animation: bob-label-in 0.6s ease forwards;
}

@keyframes bob-label-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* A hand-tuned damped swing — decreasing amplitude, ending dead at 0deg. */
.bob-settle {
  animation: bob-settle 3.4s cubic-bezier(0.36, 0.02, 0.4, 1) 1 both;
}

@keyframes bob-settle {
  0% {
    transform: rotate(16deg);
  }
  9% {
    transform: rotate(-12deg);
  }
  18% {
    transform: rotate(8.5deg);
  }
  28% {
    transform: rotate(-6deg);
  }
  38% {
    transform: rotate(4deg);
  }
  48% {
    transform: rotate(-2.4deg);
  }
  60% {
    transform: rotate(1.3deg);
  }
  74% {
    transform: rotate(-0.6deg);
  }
  88% {
    transform: rotate(0.2deg);
  }
  100% {
    transform: rotate(0deg);
  }
}

.is-driven .bob-assembly {
  transition: transform 0.7s cubic-bezier(0.36, 0.02, 0.4, 1);
}

@media (prefers-reduced-motion: reduce) {
  .bob-settle {
    animation: none;
    transform: rotate(0deg);
  }
  .is-driven .bob-assembly {
    transition: none;
  }
}
</style>
