FROM node:24.22.1-bookworm-slim
WORKDIR /app
COPY --chown=node:node server ./server
COPY --chown=node:node src/persistence/save/GameSave.ts ./src/persistence/save/GameSave.ts
COPY --chown=node:node package.json ./package.json
RUN mkdir /data && chown node:node /data
USER node
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server/main.mjs"]
