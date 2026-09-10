import { z } from 'zod';

/**
 * The words a file is described in.
 *
 * As everywhere else, migration `0006-files` repeats the literals rather than
 * importing them: a migration is a frozen record of what already ran.
 */

/**
 * A file is `pending` until the browser says the upload finished.
 *
 * The API hands out a presigned URL and never sees the bytes, so this is the
 * only thing that separates a file that arrived from one somebody asked to send
 * and then closed the tab on.
 */
export const FILE_STATES = ['pending', 'stored'] as const;

export type FileState = (typeof FILE_STATES)[number];

export const fileStateSchema = z.enum(FILE_STATES);

/** Long enough for a deep export path, short enough to be a filename. */
export const filenameSchema = z.string().trim().min(1, 'Name the file.').max(255);

/**
 * A media type, as the browser reports it.
 *
 * Not a closed list: a studio uploads `.psd`, `.exr`, `.uasset` and things
 * nobody here has heard of, and refusing an unfamiliar type would refuse most
 * of what the tool is for.
 */
export const mimeSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[\w.+-]+\/[\w.+-]+$/, 'That is not a media type.');

/**
 * Whether this is a picture.
 *
 * One definition, so the browser and the server agree about what belongs on a
 * reference sheet. The media type rather than the extension: a `.png` is only a
 * picture if the bytes are, and the browser has already looked.
 *
 * SVG is deliberately included. It is an image everywhere else in this product
 * — the worker renders one to a thumbnail like any other — and a studio's
 * icon sheets arrive as SVG.
 */
export function isImageMime(mime: string): boolean {
  return mime.trim().toLowerCase().startsWith('image/');
}

/**
 * What is said when something that is not a picture is sent somewhere pictures
 * go.
 *
 * Written once, so the browser's refusal and the server's are the same sentence
 * rather than two wordings of one rule.
 */
export function notAnImageMessage(name: string): string {
  return `${name} was not an image, other file types must be placed in the files tab`;
}

/**
 * What the file picker offers when a picture is what is wanted.
 *
 * `image/*` covers formats nobody has thought of yet, which is the point: this
 * is a hint to the operating system's dialog, and the rule that actually holds
 * is `isImageMime` on the server.
 */
export const IMAGE_FILE_ACCEPT = 'image/*';

/**
 * The largest single upload.
 *
 * Game art is large, so this is generous. It exists so a mistake fails at the
 * presign rather than after eight gigabytes have crossed the network.
 */
export const MAXIMUM_UPLOAD_BYTES = 8 * 1024 * 1024 * 1024;

export const uploadBytesSchema = z
  .number()
  .int()
  .positive('An empty file is not an upload.')
  .max(MAXIMUM_UPLOAD_BYTES, 'That file is larger than this server accepts.');

/** Hex, lower case, as every tool that prints one writes it. */
export const sha256Schema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[0-9a-f]{64}$/, 'That is not a SHA-256.');
