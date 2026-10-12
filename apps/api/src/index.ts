import { type HealthResponse, healthResponseSchema } from "@repo/shared/health";
import express from "express";
import { config } from "./config";
import { requireAdmin } from "./lib/auth";
import { prisma } from "./lib/db";
import { errorHandler } from "./lib/errors";
import { assignmentsRouter, employeesRouter } from "./routes/assignments";
import { policiesRouter } from "./routes/policies";

// runs SELECT 1 and gives up after dbTimeoutMs, so /health never hangs
async function isDatabaseUp(): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`probe timed out after ${config.dbTimeoutMs}ms`)), config.dbTimeoutMs);
  });

  try {
    await Promise.race([prisma.$queryRaw`SELECT 1`, timeout]);
    return true;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`health: database probe failed: ${reason}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const app = express();
app.disable("x-powered-by");
app.use(express.json());

app.get("/health", async (_req, res) => {
  const dbUp = await isDatabaseUp();
  const body: HealthResponse = healthResponseSchema.parse({
    status: dbUp ? "ok" : "degraded",
    db: dbUp ? "up" : "down",
    uptimeSeconds: Math.round(process.uptime()),
  });
  res.status(dbUp ? 200 : 503).json(body);
});

// every feature route needs an admin, health stays public
app.use("/policies", requireAdmin, policiesRouter);
app.use("/assignments", requireAdmin, assignmentsRouter);
app.use("/employees", requireAdmin, employeesRouter);

app.use((_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "route not found" } });
});

// express 5 forwards rejected async handlers here, no try/catch needed in routes
app.use(errorHandler);

const server = app.listen(config.port, () => {
  console.log(`api listening on :${config.port} (${config.nodeEnv})`);
});

// stop accepting requests, close the pool, then exit
function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down`);
  // hard exit if connections refuse to drain
  setTimeout(() => process.exit(1), 10_000).unref();
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));