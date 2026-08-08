FROM node:22.22.0-bookworm-slim

ARG CODEX_CLI_VERSION=0.146.1

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global "@openai/codex@${CODEX_CLI_VERSION}" \
  && npm cache clean --force

WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
  && npm cache clean --force

COPY --chown=node:node scripts ./scripts
COPY --chown=node:node web ./web
COPY --chown=node:node deploy/hindsight ./deploy/hindsight
COPY --chown=node:node deploy/codex ./deploy/codex

USER node
