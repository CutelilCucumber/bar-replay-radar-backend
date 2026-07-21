import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Runtime queries go through the POOLED connection (SUPABASE_DATABASE_URL, port 6543),
// deliberately different from the DIRECT one prisma.config.ts uses for migrations.
// `?pgbouncer=true` must be appended to this URL in your .env — it tells the pg driver
// not to use prepared statements, which pgbouncer's transaction pooling mode can't support.
const adapter = new PrismaPg({
  connectionString: process.env.SUPABASE_DATABASE_URL,
  // Prisma 7 uses node-pg directly and validates SSL certs by default (v6 silently
  // ignored invalid certs). Supabase's cert chain is fine, but if you hit a P1010
  // "denied access" error that's actually a masked SSL error, this is the fix:
  // ssl: { rejectUnauthorized: false },
});

export const prisma = new PrismaClient({ adapter });