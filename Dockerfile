# syntax=docker/dockerfile:1.7

# Multistage build:
#   1. `builder` compiles the TypeScript server (dist/index.js) and the
#      Figma plugin runtime (figma-plugin/code.js).
#   2. `runner` is a slim Alpine image with only the production dependencies
#      and the built artifacts — figma-plugin/* is included so the user can
#      mount it out and sideload into Figma desktop.
#
# Final image is small (~80 MB) and runs `plumb-mcp` over stdio by default.

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

# ---------- runner ----------
FROM node:20-alpine AS runner
WORKDIR /app

# Non-root user — defensive default; plumb-mcp doesn't need root.
RUN addgroup -S plumb && adduser -S plumb -G plumb

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

# stdio is the default MCP transport — the AI client spawns this process and
# talks to it over stdin/stdout. Pass `demo` to run the offline walkthrough
# instead, or `--help` for the full command list.
ENTRYPOINT ["node", "dist/index.js"]
