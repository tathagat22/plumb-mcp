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

USER plumb

# stdio is the default MCP transport — the AI client spawns this process and
# talks to it over stdin/stdout. Override with --help or your own args.
ENTRYPOINT ["node", "dist/index.js"]
