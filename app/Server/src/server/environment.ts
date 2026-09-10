import { z } from 'zod';

/**
 * Every environment variable the API reads, validated once at boot.
 *
 * Parsing here means a missing or malformed value stops the process with a
 * readable message instead of surfacing as `undefined` inside a request handler
 * an hour later. Add a variable to this schema before reading it anywhere else.
 */
const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),

  /**
   * The public origin this install is reached on. Behind a Cloudflare tunnel
   * this is the tunnel hostname, not the container's own address, and it is what
   * session cookies and webhook callbacks are built from.
   */
  BASE_URL: z.string().url(),

  /** Shown on the connect-to-server screen so an operator can confirm the box. */
  SERVER_NAME: z.string().min(1).default('LazyProjectManager'),

  /**
   * The key the few secrets this server must read back are encrypted with —
   * today, the webhook secret a repository signs its deliveries with.
   *
   * Optional on purpose. An install that never connects a repository has
   * nothing to encrypt, and one that has been running since before this existed
   * should not refuse to boot over a feature it does not use. `scm.connect`
   * fails with a readable message when it is missing, which is the moment it
   * actually matters.
   */
  APP_SECRET: z.preprocess(
    // `.env.example` ships this empty, so an operator who copies it unchanged
    // hands the process an empty string rather than nothing at all. Treating
    // the two the same is the difference between an install that starts
    // without the feature and one that refuses to start at all.
    (value) => (value === '' ? undefined : value),
    z.string().min(16).optional(),
  ),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  /**
   * The object store. S3-compatible rather than S3: the compose runs MinIO, and
   * a studio that already has a bucket points at that instead.
   *
   * How *this server* reaches it, and the only address there is. A browser never
   * addresses the store — it asks the API for a file and the API fetches it — so
   * there is nothing here that has to be resolvable from anywhere but inside the
   * stack. There was a second setting for that, and a release shipped it
   * pointing at a port nothing listened on (#172).
   */
  S3_ENDPOINT: z.string().url(),

  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),

  /**
   * MinIO addresses buckets by path rather than by subdomain, which is what a
   * self-hosted store on a bare hostname needs. Amazon wants this off.
   */
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  /**
   * True when the API sits behind a reverse proxy or a Cloudflare tunnel. It
   * makes Fastify read the client address and protocol from the forwarded
   * headers; leaving it off behind a tunnel means every request appears to come
   * from the proxy and secure-cookie detection breaks.
   */
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  /**
   * Directory holding the built web client. When set, the API serves the UI
   * itself, which is what lets the whole product ship as one container. Unset in
   * development, where Vite serves the client with hot reload.
   */
  WEB_ROOT: z.string().min(1).optional(),

  /**
   * Apply pending migrations during startup.
   *
   * On for the self-hosted container so that upgrading is `docker compose pull`
   * and nothing else. Off by default everywhere else, because a developer or a
   * test run should decide when the schema changes.
   */
  RUN_MIGRATIONS_ON_BOOT: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type Environment = z.infer<typeof environmentSchema>;

export function readEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  const parsed = environmentSchema.safeParse(source);

  if (!parsed.success) {
    throw new Error(describeEnvironmentProblems(parsed.error));
  }

  return parsed.data;
}

function describeEnvironmentProblems(error: z.ZodError): string {
  const problems = error.issues
    .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');

  return `Invalid environment. Copy .env.example to .env and fix:\n${problems}`;
}
