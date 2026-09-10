/**
 * Where a file is read from, and where its bytes are sent to.
 *
 * One function so the address is written once. It is relative on purpose: the
 * browser is already talking to this server, and a path resolves against
 * whatever it reached it on — a LAN address, a tunnel hostname, or the Vite dev
 * server, which proxies `/api` for exactly this reason.
 *
 * That is the whole of what #172 was about. There was an absolute URL here,
 * signed against a second hostname an operator had to supply and get right, and
 * a release shipped that setting pointing at a port nothing was listening on.
 * A path cannot be wrong about which host it means.
 */
export function fileUrl(fileId: string): string {
  return `/api/f/${fileId}`;
}

/**
 * The same file, as it was uploaded rather than as it is drawn.
 *
 * `/api/f/<id>` answers with the thumbnail when there is one, because an image
 * on a screen is being looked at. Somebody opening a working file wants the
 * forty megabytes.
 */
export function originalFileUrl(fileId: string): string {
  return `${fileUrl(fileId)}?full`;
}

/**
 * Where a picture is fetched from, once there is one to fetch.
 *
 * Null covers both "there is no picture" and "one was chosen a moment ago and
 * the bytes have not arrived" — and the caller draws the same thing for both,
 * which is a monogram or a letter. A URL for a file that is still pending would
 * be a broken image for the second or two in between.
 *
 * Every view that draws a person or a project takes its picture through here, so
 * the rule about what counts as ready is written once.
 */
export function pictureUrl(fileId: string | null, state: string | null): string | null {
  return fileId === null || state !== 'stored' ? null : fileUrl(fileId);
}
