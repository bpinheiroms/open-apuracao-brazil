FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN VITE_LIVE=1 npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/dist dist
COPY infra infra
ENV OUT=/data/live PORT=8080 NODE_ENV=production
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["sh", "-c", "node infra/collector.mjs & exec node infra/serve.mjs"]
