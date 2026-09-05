# ── Build ────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

# Dependencies first: this layer is cached until package files change.
COPY package*.json ./
RUN npm ci

COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npm run build

# Drop dev dependencies from the tree that gets copied into the runtime image.
RUN npm prune --omit=dev


# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# dumb-init reaps zombies and forwards SIGTERM, so the platform's stop signal
# reaches Nest's shutdown hooks and in-flight requests are allowed to finish.
RUN apk add --no-cache dumb-init

ENV NODE_ENV=production
WORKDIR /app

# Never run as root.
USER node

COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node package*.json ./

EXPOSE 3000

# Liveness for platforms that read the image's own healthcheck.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
