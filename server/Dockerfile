# Bun image runs the TypeScript entry directly, no build step. Build context is
# the repo root (see compose.yml) so the server can import the client's shared
# pure modules from ../src at runtime.
FROM oven/bun:1.3

WORKDIR /app/server

# Install dependencies first for layer caching.
COPY server/package.json server/bun.lock* ./
RUN bun install --frozen-lockfile || bun install

# Server source and the shared client modules it imports for validation.
COPY server ./
COPY src /app/src

EXPOSE 8787
CMD ["bun", "src/index.ts"]
