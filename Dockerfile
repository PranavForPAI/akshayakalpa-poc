# ==============================================================================
# Stage 1: Build the TypeScript backend & Prisma Client
# ==============================================================================
FROM node:20-slim AS builder

WORKDIR /app

# Install openssl (required by Prisma engine)
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy Prisma schema and generate client
COPY prisma ./prisma/
RUN npx prisma generate

# Copy application source & config and compile TypeScript
COPY tsconfig.json ./
COPY src ./src/
RUN npm run build

# ==============================================================================
# Stage 2: Minimal Production Runtime
# ==============================================================================
FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install openssl for Prisma and curl for container health checks
RUN apt-get update && apt-get install -y openssl curl && rm -rf /var/lib/apt/lists/*

# Copy package manifests & install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled code, Prisma schema and generated client from builder
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/dist ./dist

# Copy entrypoint startup script
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Expose backend port
EXPOSE 3000

# Entrypoint script waits for Postgres & runs Prisma sync before starting the app
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
