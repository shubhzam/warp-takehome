import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().startsWith("postgres"),
  DB_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),
});

// all settings live here, nothing else reads process.env
export class AppConfig {
  readonly nodeEnv: "development" | "test" | "production";
  readonly port: number;
  readonly databaseUrl: string;
  readonly dbTimeoutMs: number;

  private constructor(env: z.infer<typeof envSchema>) {
    this.nodeEnv = env.NODE_ENV;
    this.port = env.PORT;
    this.databaseUrl = env.DATABASE_URL;
    this.dbTimeoutMs = env.DB_TIMEOUT_MS;
  }

  // fail fast at boot if the environment is wrong
  static fromEnv(source: NodeJS.ProcessEnv = process.env): AppConfig {
    const parsed = envSchema.safeParse(source);
    if (!parsed.success) {
      throw new Error(`invalid environment:\n${z.prettifyError(parsed.error)}`);
    }
    return new AppConfig(parsed.data);
  }
}