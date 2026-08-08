FROM node:22.22.0-alpine

WORKDIR /app
COPY --chown=node:node services/supermemory-graphd/package.json ./package.json
COPY --chown=node:node services/supermemory-graphd/server.mjs ./server.mjs

ENV NODE_ENV=production
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
