# syntax=docker/dockerfile:1.7
FROM node:20-alpine

RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    tzdata \
    udev \
    dumb-init \
    libxml2-utils

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV NODE_ENV=production
ENV PORT=5000
ENV BACKEND_PORT=5000
ENV BIND_PUBLIC=true

WORKDIR /app
COPY app/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY app/ .
RUN mkdir -p /data/tenants && chown -R node:node /app /data/tenants

USER node
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:5000/api/health || exit 1

ENTRYPOINT ["dumb-init","--"]
CMD ["sh","-c","node scripts/init-tenants.js && node server.js"]
