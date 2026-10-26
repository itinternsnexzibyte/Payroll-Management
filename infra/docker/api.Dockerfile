# Builds the API image. Usage:
#   docker build -f infra/docker/api.Dockerfile --build-arg APP=payroll-api -t nexzi/payroll-api .
ARG NODE_VERSION=22.20.0

FROM node:${NODE_VERSION}-bookworm-slim AS build
ARG APP=payroll-api
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/${APP}/package.json apps/${APP}/package.json
RUN npm ci --workspace @nexzi/${APP} --include-workspace-root --ignore-scripts \
 && npm rebuild prisma @prisma/engines esbuild
COPY infra/build ./infra/build
COPY apps/${APP} ./apps/${APP}
RUN npm run build -w @nexzi/${APP}

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG APP=payroll-api
ENV NODE_ENV=production \
    PDF_BROWSER_PATH=/usr/bin/chromium \
    STORAGE_DIR=/var/lib/nexzi/storage
# Chromium + fonts for server-side PDF rendering (payslips, reports).
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-dejavu-core fonts-liberation openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /var/lib/nexzi/storage && chown -R node:node /var/lib/nexzi
WORKDIR /app
COPY --from=build --chown=node:node /repo/node_modules ./node_modules
COPY --from=build /repo/apps/${APP}/package.json ./package.json
COPY --from=build /repo/apps/${APP}/dist ./dist
COPY --from=build /repo/apps/${APP}/generated ./generated
COPY --from=build /repo/apps/${APP}/prisma ./prisma
COPY infra/docker/api-entrypoint.sh /usr/local/bin/api-entrypoint.sh
RUN chmod +x /usr/local/bin/api-entrypoint.sh
USER node
EXPOSE 4001 4002
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4001)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "api-entrypoint.sh"]
CMD ["node", "--enable-source-maps", "dist/server.js"]
