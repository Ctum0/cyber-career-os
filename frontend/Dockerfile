# Cyber Career OS frontend — Next.js 14 production server (`next start`).
#
# IMPORTANT — BACKEND_URL is a BUILD-time setting, not runtime:
# next.config.js rewrites() is evaluated only during `npm run build` and the
# result is baked into .next/routes-manifest.json. `next start` does NOT
# re-read it (verified against Next 14.1.0). Therefore BACKEND_URL must be
# passed as a build arg, e.g.:
#
#   docker build --build-arg BACKEND_URL=http://backend:8000 ./frontend
#
# The value must be the backend's address as reachable from THIS container
# on the docker network (http://backend:8000 with docker-compose.yml), not a
# browser-visible URL.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS build
WORKDIR /app
# Evaluated by next.config.js rewrites() during `npm run build`.
ARG BACKEND_URL=http://backend:8000
ENV BACKEND_URL=$BACKEND_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# `next start` needs the full node_modules tree — there is no
# .next/standalone output (output:'standalone' is deliberately not set), so
# the deps tree is reused instead of re-running npm ci in the runner.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY package.json package-lock.json next.config.js ./
# Non-root runtime user: node:22-slim ships a built-in `node` user (uid 1000)
# — reuse it instead of creating a duplicate. Next.js writes its cache to
# /app/.next, so ownership must be handed over.
RUN chown -R node:node /app/.next
USER node
EXPOSE 3000
CMD ["npm", "start"]
