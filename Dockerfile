FROM node:22-slim

WORKDIR /app

# Install deps first (separate layer from source) so `npm install` is cached across
# builds unless package.json/lock actually changed.
COPY package*.json ./
COPY prisma ./prisma
RUN npm install

COPY . .

# prisma.config.ts loads for every CLI command, including `generate`, and calls
# env("SUPABASE_DIRECT_URL") which throws immediately on a missing variable. Northflank
# (like most platforms) only injects real runtime env vars once the container starts —
# not during this build step — so without a placeholder, config-loading fails before
# `generate` ever gets to do anything. `generate` itself never actually connects to the
# DB with this value, so a placeholder is safe here; the REAL value comes from
# Northflank's runtime env vars when the container starts for real.
ENV SUPABASE_DIRECT_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npx prisma generate

ENV NODE_ENV=production

# Northflank auto-detects this and wires up networking accordingly — must match
# whatever HOST/PORT the app actually binds to (src/server.ts defaults to 0.0.0.0:3000,
# overridable via the PORT env var Northflank injects at runtime).
EXPOSE 3000

# dotenv/config in server.ts is a harmless no-op here — no .env file exists in the
# container, and Northflank injects real env vars directly into process.env.
CMD ["npx", "tsx", "src/server.ts"]