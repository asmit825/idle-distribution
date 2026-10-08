# -------------------------------------------------------------
# Stage 1: Rust WASM Builder
# -------------------------------------------------------------
FROM rust:1.82-slim AS wasm-builder
RUN apt-get update && apt-get install -y curl build-essential pkg-config && rm -rf /var/lib/apt/lists/*
RUN curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
WORKDIR /app
COPY crates/ crates/
RUN wasm-pack build crates/pallet_sim --target web --out-dir ../../pkg

# -------------------------------------------------------------
# Stage 2: Node Application Builder
# -------------------------------------------------------------
FROM node:22-alpine AS app-builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY --from=wasm-builder /app/pkg ./pkg
COPY . .
ENV BASE_URL=/idle-distribution/
RUN npm run typecheck && npx vite build

# -------------------------------------------------------------
# Stage 3: Minimal Production Runtime
# -------------------------------------------------------------
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY --from=app-builder /app/dist ./dist
COPY server/ ./server/

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server/index.js"]
