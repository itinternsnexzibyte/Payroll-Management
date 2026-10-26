# Builds one web image (Next.js standalone). The API URL is baked in at build time.
#   docker build -f infra/docker/web.Dockerfile --build-arg APP=payroll-web --build-arg API_INTERNAL_URL=http://payroll-api:4001 -t nexzi/payroll-web .
ARG NODE_VERSION=22.20.0

FROM node:${NODE_VERSION}-bookworm-slim AS build
ARG APP=payroll-web
ARG API_INTERNAL_URL
ENV API_INTERNAL_URL=${API_INTERNAL_URL} NEXT_TELEMETRY_DISABLED=1 NEXT_DIST_DIR=.next
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps/${APP}/package.json apps/${APP}/package.json
RUN npm ci --workspace @nexzi/${APP} --include-workspace-root --ignore-scripts
COPY apps/${APP} ./apps/${APP}
RUN npm run build -w @nexzi/${APP}

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG APP=payroll-web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/${APP}/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/${APP}/.next/static ./apps/${APP}/.next/static
USER node
ENV APP_DIR=apps/${APP}
EXPOSE 3001 3002
CMD ["sh", "-c", "node $APP_DIR/server.js"]
