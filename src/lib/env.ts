import { z } from 'zod';

/**
 * Read lazily, never at module scope: `next build` collects page data without
 * production credentials present, and a top-level throw there would break CI
 * long before anything is actually misconfigured.
 */
const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url({ message: 'NEXT_PUBLIC_SUPABASE_URL must be the Supabase project URL' }),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(10, { message: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set' }),
  SUPABASE_SECRET_KEY: z.string().min(10, { message: 'SUPABASE_SECRET_KEY (server-only) is not set' }),
  NEXT_PUBLIC_SITE_URL: z.string().url().default('http://localhost:3000'),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_DEFAULT_FROM: z.string().default('Yourbiss <no-reply@yourbiss.com>'),
  APP_ENCRYPTION_KEY: z
    .string()
    .length(64, { message: 'APP_ENCRYPTION_KEY must be 64 hex characters (32 bytes)' })
    .optional(),
  CRON_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;
let cachedError: string | undefined;

function read(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    cachedError = parsed.error.issues
      .map((i) => `${i.path.join('.') || 'env'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment — ${cachedError}`);
  }
  cached = parsed.data;
  return cached;
}

/** Throws with a readable message the first time a server route needs config. */
export const env = new Proxy({} as Env, {
  get(_t, prop: string) {
    return read()[prop as keyof Env];
  },
  has(_t, prop: string) {
    try {
      return read()[prop as keyof Env] !== undefined;
    } catch {
      return false;
    }
  },
  ownKeys() {
    return Reflect.ownKeys(read());
  },
  getOwnPropertyDescriptor() {
    return { enumerable: true, configurable: true };
  },
});

/** True when the variable set is complete enough to run; used by setup screens. */
export function envStatus(): { ok: boolean; missing: string[] } {
  try {
    read();
    return { ok: true, missing: [] };
  } catch (e) {
    const message = e instanceof Error ? e.message : '';
    return { ok: false, missing: [message.replace(/^Invalid environment — /, '')] };
  }
}

/** Optional-only access, so feature checks never throw. */
export function optionalEnv(key: keyof Env): Env[keyof Env] | undefined {
  if (cached) return cached[key];
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) return undefined;
  cached = parsed.data;
  return cached[key];
}
