FROM node:22-alpine

LABEL org.opencontainers.image.title="meta-mcp" \
      org.opencontainers.image.description="Enables AI assistants to manage Instagram and Threads accounts — publish content, handle comments, view insights, search hashtags, and manage DMs through the Meta Graph API" \
      org.opencontainers.image.source="https://github.com/exileum/meta-mcp" \
      org.opencontainers.image.url="https://github.com/exileum/meta-mcp" \
      org.opencontainers.image.documentation="https://github.com/exileum/meta-mcp#readme" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app

RUN addgroup -S app && adduser -S app -G app && chown app:app /app

COPY --chown=app:app package.json package-lock.json ./
RUN npm ci --omit=dev
ENV NODE_ENV=production
COPY --chown=app:app dist/ ./dist/

USER app

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD pidof node

ENTRYPOINT ["node", "dist/index.js"]
