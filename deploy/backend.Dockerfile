# The save backend: Node's built-in SQLite, no npm packages. It checks uploaded saves with the
# game's own GameSave.ts (type imports only), run by Node's TypeScript stripping.
FROM node:24.22.1-bookworm-slim
WORKDIR /app
COPY --chown=node:node server ./server
COPY --chown=node:node src/persistence/save/GameSave.ts ./src/persistence/save/GameSave.ts
# The save envelope (shared with the game) and this deploy's build keys (deploy/rotate-build-key.mjs).
COPY --chown=node:node src/account/SaveEnvelope.ts ./src/account/SaveEnvelope.ts
COPY --chown=node:node deploy ./deploy
# The rooms an admin may move a stuck player to (server/live.mjs).
COPY --chown=node:node public/pack/world/rooms.json ./public/pack/world/rooms.json
COPY --chown=node:node package.json ./package.json
RUN mkdir /data && chown node:node /data
USER node
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server/main.mjs"]
