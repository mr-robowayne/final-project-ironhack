# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS build
WORKDIR /app

COPY app/package.json app/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY app/ ./
ARG REACT_APP_API_BASE=https://backend.example.com
ARG REACT_APP_API_URL=https://backend.example.com
ARG REACT_APP_DEFAULT_TENANT=dhpatientsync
ARG REACT_APP_LT_API_URL=
ARG REACT_APP_CHAT_NOTIFICATION_PREVIEW=false
ARG REACT_APP_BACKEND_PORT=
ARG REACT_APP_DEV_TENANT_ID=
ARG REACT_APP_DEV_USER_ID=
ENV REACT_APP_API_BASE=${REACT_APP_API_BASE}
ENV REACT_APP_API_URL=${REACT_APP_API_URL}
ENV REACT_APP_DEFAULT_TENANT=${REACT_APP_DEFAULT_TENANT}
ENV REACT_APP_LT_API_URL=${REACT_APP_LT_API_URL}
ENV REACT_APP_CHAT_NOTIFICATION_PREVIEW=${REACT_APP_CHAT_NOTIFICATION_PREVIEW}
ENV REACT_APP_BACKEND_PORT=${REACT_APP_BACKEND_PORT}
ENV REACT_APP_DEV_TENANT_ID=${REACT_APP_DEV_TENANT_ID}
ENV REACT_APP_DEV_USER_ID=${REACT_APP_DEV_USER_ID}
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
