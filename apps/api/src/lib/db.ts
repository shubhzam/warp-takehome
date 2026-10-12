import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "../config";
import { PrismaClient } from "../generated/prisma/client";

// the one prisma client for the whole process, everything imports it from here
export const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: config.databaseUrl,
    // stop a dead database from hanging a request on pool checkout
    connectionTimeoutMillis: config.dbTimeoutMs,
  }),
});