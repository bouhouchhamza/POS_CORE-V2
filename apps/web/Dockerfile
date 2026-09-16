FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY apps apps
COPY packages packages
RUN npm ci --ignore-scripts
ARG VITE_API_URL=/api
ARG VITE_PUBLIC_APP_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_PUBLIC_APP_URL=$VITE_PUBLIC_APP_URL
RUN npm run build -w @bimik/shared-types && npm run build -w @bimik/validation && npm run build -w @bimik/web
FROM caddy:2-alpine
COPY --from=build /app/apps/web/dist /srv
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
