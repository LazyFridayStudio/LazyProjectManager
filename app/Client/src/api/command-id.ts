/**
 * The identifier a command carries so it can be retried without doing twice.
 *
 * `crypto.randomUUID()` was called directly here, and it is documented as
 * available only in a *secure context*. Localhost counts as one; a plain-HTTP
 * address on a studio's own network does not — so on `http://192.168.1.10:24571`
 * the function is simply `undefined`, and every command threw before it reached
 * the fetch. Nothing appeared in the network tab and the screen said "could not
 * reach the server", which is the one explanation that was not true.
 *
 * `crypto.getRandomValues` has no such restriction, so the fallback is the same
 * randomness written out by hand.
 */
export function createCommandId(): string {
  // Typed as always present, so it has to be asked about as an unknown: the
  // whole point is the builds where the type is wrong about the browser.
  const generate: unknown = (crypto as { randomUUID?: unknown }).randomUUID;

  if (typeof generate === 'function') {
    return crypto.randomUUID();
  }

  return uuidFromBytes(crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * Sixteen random bytes, as a version 4 UUID.
 *
 * Two of them are not random: the version nibble says which kind of UUID this
 * is, and the variant bits say whose scheme it follows. A string that skipped
 * them would look like a UUID and be refused by anything that checks one —
 * which the command envelope does.
 */
export function uuidFromBytes(bytes: Uint8Array): string {
  const marked = Uint8Array.from(bytes);

  // Version 4, and the RFC 4122 variant.
  marked[6] = ((marked[6] ?? 0) & 0x0f) | 0x40;
  marked[8] = ((marked[8] ?? 0) & 0x3f) | 0x80;

  const hex = [...marked].map((byte) => byte.toString(16).padStart(2, '0')).join('');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
