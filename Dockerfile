# No `# syntax=` directive on purpose: it makes Compose pull a BuildKit
# frontend image, which fails on hosts that can't reach Docker Hub. Nothing
# here needs BuildKit-only features.

# Three stages. The app is a plain Next.js server with no runtime secrets and
# no server-side TTS — speech happens in the visitor's browser — so the runner
# stage needs nothing but the standalone bundle.

# Override to build behind a registry mirror, e.g.
#   docker build --build-arg NODE_IMAGE=public.ecr.aws/docker/library/node:22-slim .
ARG NODE_IMAGE=node:22-slim

# ---- deps ------------------------------------------------------------------
# Copy the manifest and lockfile alone, so this layer caches until a dependency
# actually changes rather than on every source edit.
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# Plenty of hosts — VPSes especially — advertise an AAAA record with no working
# IPv6 route, and Node picks it and hangs. Prefer A records for build-time
# fetches. Harmless where IPv6 does work.
ENV NODE_OPTIONS=--dns-result-order=ipv4first
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder ---------------------------------------------------------------
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ENV NODE_OPTIONS=--dns-result-order=ipv4first
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runner ----------------------------------------------------------------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

# HOSTNAME must be set explicitly: Docker injects HOSTNAME=<container id>, and
# the standalone server reads that variable to decide what to bind to.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=6001 \
    HOSTNAME=0.0.0.0

RUN useradd --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static

USER nextjs
EXPOSE 6001

CMD ["node", "server.js"]
