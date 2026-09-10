import {
  createQuerySuccessSchema,
  failureSchema,
  type CommandDefinition,
  type CommandSuccess,
  type QueryDefinition,
  type QueryParams,
  type QueryView,
} from '@lpm/shared';
import type { z } from 'zod';
import { createCommandId } from './command-id.js';

import { ApiContractError, ApiFailureError, ApiUnreachableError } from './api-failure-error.js';

/**
 * Talks to one LazyProjectManager server.
 *
 * The base URL is supplied rather than compiled in, because the connect-to-server
 * screen is how a client chooses its server — the same build has to work against
 * a Cloudflare tunnel hostname, a LAN address and localhost.
 */
export class ApiClient {
  readonly baseUrl: string;

  constructor(baseUrl: string) {
    // A trailing slash would produce `//api/q/...`, which some proxies rewrite
    // and others reject.
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  /**
   * Runs a query and returns its view model.
   *
   * The response is parsed against the contract's own schema, so a server that
   * has drifted fails here with a clear message instead of surfacing as
   * `undefined` three components deep.
   */
  async query<TDefinition extends QueryDefinition>(
    definition: TDefinition,
    params: QueryParams<TDefinition>,
  ): Promise<QueryView<TDefinition>> {
    const url = new URL(`${this.baseUrl}/api/q/${definition.name}`);
    appendSearchParams(url, params);

    const body = await this.send(definition.name, url, { method: 'GET' });
    const parsed = createQuerySuccessSchema(definition.viewSchema).safeParse(body);

    if (!parsed.success) {
      throw new ApiContractError(definition.name, parsed.error.issues[0]?.message ?? 'unknown');
    }

    // `QueryView<TDefinition>` widens to `any` for the generic constraint, even
    // though it is precise at every real call site. The value has just been
    // validated against the contract's own schema on the line above, which is
    // the strongest guarantee available here.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return parsed.data.data;
  }

  /**
   * Sends a command.
   *
   * `commandId` is generated here so a retry of the same logical action reuses
   * it and the server can recognise the duplicate.
   *
   * The input is the schema's *input* type rather than its output: a field the
   * schema defaults is one the caller may leave out.
   */
  async command<TDefinition extends CommandDefinition>(
    definition: TDefinition,
    input: z.input<TDefinition['inputSchema']>,
    commandId: string = createCommandId(),
  ): Promise<CommandSuccess> {
    const url = new URL(`${this.baseUrl}/api/c/${definition.name}`);

    const body = await this.send(definition.name, url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commandId, ...(input as Record<string, unknown>) }),
    });

    return body as CommandSuccess;
  }

  /**
   * The single place a response is turned into either a value or a thrown
   * failure. Every call above stays on its happy path because of it.
   */

  private async send(operationName: string, url: URL, init: RequestInit): Promise<unknown> {
    let response: Response;

    try {
      // Cookies carry the session, and the web app may be served from a
      // different origin than the API when running behind a tunnel.
      response = await fetch(url, { ...init, credentials: 'include' });
    } catch (error) {
      throw new ApiUnreachableError(this.baseUrl, error);
    }

    const body: unknown = await response.json().catch(() => null);
    const failure = failureSchema.safeParse(body);

    if (failure.success) {
      throw new ApiFailureError(failure.data);
    }

    if (!response.ok) {
      throw new ApiContractError(operationName, `HTTP ${String(response.status)}`);
    }

    return body;
  }
}

/**
 * Copies query parameters onto the URL.
 *
 * Only primitives are accepted: a query definition that needs to send structured
 * data has the wrong parameter shape, and silently stringifying an object into
 * `[object Object]` would hide that.
 */
function appendSearchParams(url: URL, params: Readonly<Record<string, unknown>>): void {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new TypeError(`Query parameter "${key}" must be a string, number or boolean.`);
    }

    url.searchParams.set(key, String(value));
  }
}
