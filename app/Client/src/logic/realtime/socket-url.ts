/**
 * The socket address for an API base URL.
 *
 * `http` becomes `ws` and `https` becomes `wss`, so an install behind a
 * Cloudflare tunnel upgrades over TLS rather than being blocked as mixed
 * content.
 */
export function toSocketUrl(baseUrl: string): string {
  const url = new URL('/ws', baseUrl);

  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

  return url.toString();
}
