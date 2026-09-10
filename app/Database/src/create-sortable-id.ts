import { randomFillSync } from 'node:crypto';

const UUID_BYTE_LENGTH = 16;
const TIMESTAMP_BYTE_LENGTH = 6;

/**
 * Generates a UUIDv7: a random identifier whose leading bits are the creation
 * timestamp, so keys sort by time.
 *
 * `domain_event` relies on this. The worker drains the outbox in occurrence
 * order, and a v4 key would scatter inserts across the index at random, turning
 * an append-only table into one that rewrites pages all over the B-tree.
 *
 * Layout, from RFC 9562: 48 bits of Unix milliseconds, 4 bits of version, 12
 * bits random, 2 bits variant, 62 bits random.
 */
export function createSortableId(now: number = Date.now()): string {
  const bytes = new Uint8Array(UUID_BYTE_LENGTH);
  randomFillSync(bytes, TIMESTAMP_BYTE_LENGTH);

  writeTimestamp(bytes, now);

  // Version 7 in the high nibble of byte 6.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  // RFC 4122 variant in the top two bits of byte 8.
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  return formatAsUuid(bytes);
}

function writeTimestamp(bytes: Uint8Array, milliseconds: number): void {
  let remaining = milliseconds;

  for (let index = TIMESTAMP_BYTE_LENGTH - 1; index >= 0; index--) {
    bytes[index] = remaining & 0xff;
    // Division rather than `>>>`, because a 48-bit value overflows the 32-bit
    // integers JavaScript's bitwise operators work on.
    remaining = Math.floor(remaining / 256);
  }
}

function formatAsUuid(bytes: Uint8Array): string {
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
