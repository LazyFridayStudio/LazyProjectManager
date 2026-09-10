/**
 * How the Files list says which file is being dragged.
 *
 * A private media type rather than `text/plain` or the anchor's own href: a link
 * dragged out of the list would otherwise arrive as a MinIO address with a
 * signature on it, which is both wrong in a description and dead in ten minutes.
 * Checking for this first means a real link dragged in from elsewhere still
 * behaves like a link.
 */
export const ATTACHMENT_MEDIA_TYPE = 'application/x-lpm-attachment';

export interface DraggedAttachment {
  readonly fileId: string;
  readonly filename: string;
}

export function writeDraggedAttachment(attachment: DraggedAttachment): string {
  return JSON.stringify(attachment);
}

/** Returns null for anything that is not one of ours. */
export function readDraggedAttachment(payload: string): DraggedAttachment | null {
  if (payload === '') {
    return null;
  }

  try {
    const parsed = JSON.parse(payload) as Partial<DraggedAttachment>;

    return typeof parsed.fileId === 'string' && typeof parsed.filename === 'string'
      ? { fileId: parsed.fileId, filename: parsed.filename }
      : null;
  } catch {
    return null;
  }
}
