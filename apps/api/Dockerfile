FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY apps apps
COPY packages packages
RUN npm ci
RUN npm run build -w @bimik/shared-types && npm run build -w @bimik/validation && npm run build -w @bimik/api && npm prune --omit=dev

FROM node:22-alpine
RUN addgroup -S bimik && adduser -S -G bimik bimik
WORKDIR /app
COPY --from=build --chown=bimik:bimik /app/node_modules ./node_modules
COPY --from=build --chown=bimik:bimik /app/apps/api ./apps/api
COPY --from=build --chown=bimik:bimik /app/packages ./packages
RUN mkdir -p /app/uploads && chown bimik:bimik /app/uploads
USER bimik
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["node","apps/api/dist/src/server.js"]
