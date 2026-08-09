FROM node:22-slim

WORKDIR /app

# Install deps first (separate layer from source) so `npm install` is cached across
# builds unless package.json/lock actually changed.
COPY package*.json ./
COPY prisma ./prisma
RUN npm install

COPY . .

# Prisma 7 + @prisma/adapter-pg means the app talks to Postgres via a pure-JS driver,
# not Prisma's native query-engine binary — so this generate step doesn't need to
# download a platform-specific binary at all, which keeps the image simpler and the
# build less fragile across architectures than Prisma 6-style setups were.
RUN npx prisma generate

ENV NODE_ENV=production

# Northflank auto-detects this and wires up networking accordingly — must match
# whatever HOST/PORT the app actually binds to (src/server.ts defaults to 0.0.0.0:3000,
# overridable via the PORT env var Northflank injects at runtime).
EXPOSE 3000

# dotenv/config in server.ts is a harmless no-op here — no .env file exists in the
# container, and Northflank injects real env vars directly into process.env.
CMD ["npx", "tsx", "src/server.ts"]