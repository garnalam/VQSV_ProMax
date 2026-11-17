# The game, built from this repo, served by Caddy. `vite build` only: the type check (`tsc -b`)
# runs on a dev machine before pushing; this 2 GB server would run out of memory on it.
FROM node:24.22.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV NODE_OPTIONS=--max-old-space-size=1024
RUN npx vite build

FROM caddy:2.10.2-alpine
COPY --from=build /app/dist /srv
