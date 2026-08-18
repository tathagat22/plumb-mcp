# syntax=docker/dockerfile:1.7

# Multistage build:
#   1. `builder`  compiles the TypeScript server (dist/index.js), the Figma
#                 plugin runtime (figma-plugin/code.js), and Plumb Studio.
#   2. `verifier` adds a headless Chromium for the workloads that must RENDER a
#                 page (`plumb-mcp verify` / `fit`). Opt-in via --target.
#   3. `runner`   is the default: a slim image with only the production
#                 dependencies and the built artifacts — figma-plugin/* is
#                 included so the user can mount it out and sideload into
#                 Figma desktop.
#
# The default image is small (~230 MB) and runs `plumb-mcp` over stdio.

# ---------- builder ----------
FROM node:20-alpine AS builder
WORKDIR /app

# Copy dependency manifests first so Docker can cache npm ci across rebuilds.
COPY package.json package-lock.json ./
RUN npm ci

# Now bring in the source and build both halves.
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
COPY scripts ./scripts
COPY figma-plugin ./figma-plugin
# `npm run build` also builds Plumb Studio (studio/ → dist/studio), so the
# bridge can serve the live cockpit from the image. Without this COPY the
# build's `npm --prefix studio ci` step fails.
COPY studio ./studio
RUN npm run build

# Drop devDependencies so the runtime stage stays lean.
RUN npm prune --omit=dev

# ---------- verifier ----------
# Same server, plus a headless Chromium, for the workloads that need to RENDER
# a page: `plumb-mcp verify` and `plumb-mcp fit`. Kept as a separate target
# because Chromium roughly triples the image, and the bridge/MCP path — which
# is what most deployments run — never opens a browser.
#
# Build with:  docker build --target verifier -t plumb-mcp:verifier .
# Used by the continuous design-drift CronJob in deploy/ (see deploy/README.md).
#
# Declared BEFORE `runner` on purpose: Docker treats the last stage as the
# default target, so a plain `docker build .` must still produce the slim
# server image, not this one.
FROM node:20-alpine AS verifier
WORKDIR /app

# `chromium` lands at /usr/bin/chromium, which src/cli/chrome.ts already probes,
# so no PLUMB_CHROME is needed. The font packages are not optional: without
# them Chromium renders every glyph as a box and every text delta is noise.
RUN apk add --no-cache \
      chromium \
      font-noto \
      font-noto-emoji \
      ttf-freefont \
    && addgroup -g 65532 -S plumb \
    && adduser -u 65532 -S plumb -G plumb

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/figma-plugin ./figma-plugin
COPY package.json ./

ENV PLUMB_ASSETS_DIR=/data/assets \
    PLUMB_SCREENSHOTS_DIR=/data/screenshots \
    PLUMB_CACHE_DIR=/data/cache \
    CHROME_PATH=/usr/bin/chromium \
    HOME=/tmp
RUN mkdir -p /data/assets /data/screenshots /data/cache && chown -R plumb:plumb /data
VOLUME ["/data"]

USER plumb

ENTRYPOINT ["node", "dist/index.js"]

# ---------- runner ----------
FROM node:20-alpine AS runner
WORKDIR /app

# Non-root user — defensive default; plumb-mcp doesn't need root. The UID/GID
# are pinned rather than left to Alpine's `-S` allocator so a base-image bump
# can't silently move them out from under a Kubernetes `runAsUser`, or from
# under the /data ownership set below.
RUN addgroup -g 65532 -S plumb && adduser -u 65532 -S plumb -G plumb

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/figma-plugin ./figma-plugin
COPY package.json ./

# Where the tools write, when the caller doesn't override. Declared as volumes
# so a `docker run` without -v doesn't lose exported assets into the container
# layer, and so the paths exist for a non-root user.
ENV PLUMB_ASSETS_DIR=/data/assets \
    PLUMB_SCREENSHOTS_DIR=/data/screenshots \
    PLUMB_CACHE_DIR=/data/cache
RUN mkdir -p /data/assets /data/screenshots /data/cache && chown -R plumb:plumb /data
VOLUME ["/data"]

USER plumb

# One process per container, so pin the bridge port instead of scanning the
# 31337-31346 pool. That also gives the healthcheck below a port it can count
# on. The bind address stays loopback by default — compose and the Helm chart
# set PLUMB_BRIDGE_HOST=0.0.0.0 when the port is genuinely published.
ENV PLUMB_BRIDGE_PORT=31337

# The bridge serves /healthz (liveness plus whether a plugin is paired), so
# `docker ps` and compose can report real health rather than "the process has
# not exited yet". Uses node's own fetch — no curl in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PLUMB_BRIDGE_PORT||31337)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# stdio is the default MCP transport — the AI client spawns this process and
# talks to it over stdin/stdout. Pass `demo` to run the offline walkthrough
# instead, or `--help` for the full command list.
ENTRYPOINT ["node", "dist/index.js"]
