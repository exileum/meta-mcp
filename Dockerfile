FROM node:22-alpine
WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

COPY --chown=app:app package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=app:app dist/ ./dist/

USER app
ENTRYPOINT ["node", "dist/index.js"]
