/** The path a forge posts its deliveries to. */
export const WEBHOOK_PATH = '/webhooks/scm';

/**
 * Where a provider should send its deliveries.
 *
 * Built from `BASE_URL` rather than from the request, because the address to
 * paste into GitHub is the one this install is reached on from outside — which
 * behind a tunnel is not the host header, and from a settings screen opened on
 * `localhost` is not that either.
 */
export function buildWebhookUrl(baseUrl: string, connectionId: string): string {
  return new URL(`${WEBHOOK_PATH}/${connectionId}`, baseUrl).toString();
}
