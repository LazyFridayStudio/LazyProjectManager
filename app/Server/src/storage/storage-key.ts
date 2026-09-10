/**
 * Where an object lives in the store.
 *
 * Built from ids rather than from the filename: two people uploading
 * `concept.psd` on the same day must not collide, and a key made from something
 * a person typed is a key somebody can climb out of with `../`.
 *
 * The account comes first so one studio's objects can be listed, counted or
 * lifted out without touching anybody else's — which is what a backup and a
 * tenancy boundary both need.
 */
export function buildStorageKey(accountId: string, fileId: string, filename: string): string {
  return `${accountId}/${fileId}/${sanitiseFilename(filename)}`;
}

/**
 * The filename, kept only for what it tells a person and a download header.
 *
 * Anything that could change what the key means is replaced rather than
 * stripped, so two different names never sanitise to the same thing within a
 * file's own folder.
 */
function sanitiseFilename(filename: string): string {
  const cleaned = filename
    .normalize('NFKD')
    // Decomposing leaves the accent behind as its own character, which would
    // otherwise become a separator and split "Ötzi" into "O-tzi".
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(0, 120);

  return cleaned === '' ? 'file' : cleaned;
}
