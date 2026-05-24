import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(10000),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-5.4-mini"),
  LINE_CHANNEL_SECRET: z.string().optional(),
  LINE_CHANNEL_ACCESS_TOKEN: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  ADMIN_TOKEN: z.string().optional(),
  APP_BASE_URL: z.string().optional(),
  PLAYWRIGHT_HEADLESS: z
    .string()
    .default("true")
    .transform((value) => value !== "false"),
  SEARCH_TIMEOUT_MS: z.coerce.number().default(45_000),
  MAX_SEARCH_CONCURRENCY: z.coerce.number().int().positive().default(1),
  RUN_LIVE_IKYU: z
    .string()
    .default("false")
    .transform((value) => value === "true")
});

export const config = EnvSchema.parse(process.env);

export function requireEnv(name: keyof typeof config): string {
  const value = config[name];
  if (!value || typeof value !== "string") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}
