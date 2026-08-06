# Agent Mission Control (Next.js app) — production container for gpu1
#
# Uses `output: "standalone"` (next.config.ts) — the build emits
# .next/standalone/server.js plus a pruned node_modules containing ONLY the
# deps the server actually uses at runtime (traced by Next), so the runtime
# image does NOT need `npm ci` or the full node_modules tree. Confirmed
# against this Next.js version's docs: node_modules/next/dist/docs/01-app/
# 01-getting-started/17-deploying.md → Docker section → "Docker Standalone
# Output" example (vercel/next.js/tree/canary/examples/with-docker).
#
# Standalone layout after `next build` (relative to repo root):
#   .next/standalone/server.js   — the entrypoint (`node server.js`)
#   .next/standalone/.next/      — traced server chunks (comes with the copy)
#   .next/static/                — client assets, NOT included in standalone,
#                                   must be copied to .next/standalone/.next/static
#   public/                      — static files, NOT included in standalone,
#                                   must be copied to .next/standalone/public
#
# Build context MUST be the repo root (docker-compose.yml sets context: ../..)
# — this Dockerfile COPYs package.json, src/, public/, next.config.ts, etc.
# from there. Build stage does NOT receive runtime secrets (AMC_SUPABASE_URL,
# OPENAI_API_KEY, ...) — `next build` reads process.env for build-time only
# concerns (none of ours require a live DB/API connection); every secret this
# app needs is read server-side at REQUEST time (process.env in route
# handlers / server components), which only requires the env to be present
# when the CONTAINER runs, not when the IMAGE builds. All secrets are
# injected at runtime via docker-compose.yml (${VAR} indirection) — never
# baked into this image.

# ---------------------------------------------------------------------------
# Stage 1: builder
# ---------------------------------------------------------------------------
FROM node:22-slim AS builder

WORKDIR /app

# Install dependencies first (better layer caching).
COPY package.json package-lock.json ./
# Motion+ registry auth — pass at build time only (never commit tokens).
# docker compose: build.args.NPM_TOKEN from deploy/app/.env or shell env.
ARG NPM_TOKEN
RUN if [ -n "$NPM_TOKEN" ]; then \
      printf '@motionplus:registry=https://api.motion.dev/npm/\n//api.motion.dev/:_authToken=%s\n' "$NPM_TOKEN" > .npmrc; \
    fi
RUN npm ci

# Copy the rest of the repo needed to build (.dockerignore already strips
# .env*, .git, node_modules, .next, .claude, .github — the build regenerates
# .next from scratch).
COPY . .

# `next build` with output: "standalone" produces .next/standalone/.
# No runtime secrets passed here on purpose (see header note above).
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: runner
# ---------------------------------------------------------------------------
FROM node:22-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Standalone server + its pruned node_modules (traced by Next at build time).
COPY --from=builder /app/.next/standalone ./
# Client static assets — not included in the standalone output, must be
# placed at .next/static relative to server.js.
COPY --from=builder /app/.next/static ./.next/static
# Public static files (favicon, images, ...) — same story, served from
# ./public relative to server.js. Directory exists (currently empty) so this
# COPY never fails even with nothing in it yet.
COPY --from=builder /app/public ./public

EXPOSE 3000

# server.js sits at the root of the standalone output after the copy above —
# confirmed by the doc's Docker Standalone Output example.
CMD ["node", "server.js"]
