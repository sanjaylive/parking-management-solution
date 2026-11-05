import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default('redis://127.0.0.1:57379'),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().default(60 * 60 * 24 * 30),
  QR_SIGNING_SECRET: z.string().min(32),
  DEVICE_SECRET_ENCRYPTION_KEY: z.string().min(32),
  OTP_PROVIDER: z.enum(['console', 'msg91', 'twilio']).default('console'),
  PAYMENT_PROVIDER: z.enum(['sandbox', 'razorpay']).default('sandbox'),
  PAYMENT_WEBHOOK_SECRET: z.string().min(8),
  CORS_ORIGINS: z.string().default(''),
  /**
   * Staging escape hatch: lets a NODE_ENV=production build run with the console OTP provider and the sandbox
   * payment provider (e.g. a demo VPS before SMS/Razorpay credentials exist). OTPs are then returned in the API
   * response, so never set this on a deployment that holds real customer data.
   */
  ALLOW_SANDBOX_PROVIDERS: z.enum(['true', 'false']).transform((v) => v === 'true').default(false),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error('Invalid environment: ' + JSON.stringify(parsed.error.flatten().fieldErrors));
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.ALLOW_SANDBOX_PROVIDERS) {
    if (parsed.data.OTP_PROVIDER === 'console') throw new Error('OTP_PROVIDER=console is not allowed in production');
    if (parsed.data.PAYMENT_PROVIDER === 'sandbox') throw new Error('PAYMENT_PROVIDER=sandbox is not allowed in production');
  }
  cached = parsed.data;
  return cached;
}

/** True when dev-only providers (console OTP, sandbox payments) may operate: outside production, or on an explicitly flagged staging box. */
export function sandboxAllowed(): boolean {
  const e = env();
  return e.NODE_ENV !== 'production' || e.ALLOW_SANDBOX_PROVIDERS;
}
