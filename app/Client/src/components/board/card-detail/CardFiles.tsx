import type { CardDetailView } from '@lpm/shared';
import { useRef, useState, type DragEvent } from 'react';

import { Button } from '../../ui/index.js';
import { joinClassNames } from '../../../lib/join-class-names.js';
import {
  writeDraggedAttachment,
  ATTACHMENT_MEDIA_TYPE,
} from '../../../logic/board/card-detail/attachment-drag.js';
import styles from './CardActivity.module.css';
import { useCardFiles } from '../../../logic/board/card-detail/use-card-files.js';

export interface CardFilesProps {
  readonly card: CardDetailView;
  readonly projectSlug: string;
  readonly canWrite: boolean;
}

/**
 * The files on a card, and somewhere to drop more.
 *
 * Every type is accepted. A studio uploads `.blend`, `.substance` and `.psd`
 * alongside the PNGs, and refusing what the browser cannot name would refuse
 * most of what this is for.
 */
export function CardFiles({
  card,
  projectSlug,
  canWrite,
}: CardFilesProps): React.JSX.Element | null {
  const [problem, setProblem] = useState<string | null>(null);
  const [isOver, setIsOver] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const files = useCardFiles(card.id, projectSlug, setProblem);

  // Nothing attached and no way to attach: the heading would say only that.
  if (card.attachments.length === 0 && !canWrite) {
    return null;
  }

  const uploadAll = (chosen: FileList | null): void => {
    setProblem(null);

    for (const file of chosen ?? []) {
      files.upload.mutate(file);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setIsOver(false);
    uploadAll(event.dataTransfer.files);
  };

  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>Files</h3>

      <ul className={styles.tiles}>
        {card.attachments.map((attachment) => (
          <li key={attachment.id} className={styles.tile}>
            <a
              className={styles.attachmentName}
              href={attachment.url}
              target="_blank"
              rel="noreferrer"
              draggable
              onDragStart={(event) => {
                // Announced as ours, so dropping it into a description writes an
                // image rather than pasting the signed address behind the link.
                event.dataTransfer.setData(
                  ATTACHMENT_MEDIA_TYPE,
                  writeDraggedAttachment({
                    fileId: attachment.fileId,
                    filename: attachment.filename,
                  }),
                );
                event.dataTransfer.effectAllowed = 'copy';
              }}
            >
              {attachment.filename}
            </a>
            <span className={styles.attachmentSize}>{formatBytes(attachment.bytes)}</span>
            {canWrite && (
              <button
                type="button"
                className={styles.rowAction}
                onClick={() => {
                  files.detach.mutate({ attachmentId: attachment.id });
                }}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>

      {canWrite && (
        <>
          <div
            className={joinClassNames(styles.dropZone, isOver && styles.dropZoneOver)}
            onDragOver={(event) => {
              // Without this the browser opens the file instead, which loses
              // whatever was on screen.
              event.preventDefault();
              setIsOver(true);
            }}
            onDragLeave={() => {
              setIsOver(false);
            }}
            onDrop={onDrop}
          >
            <span>Drop files here</span>
            <Button
              busy={files.upload.isPending}
              busyLabel="Uploading…"
              onClick={() => {
                picker.current?.click();
              }}
            >
              Choose a file
            </Button>
          </div>

          <input
            ref={picker}
            type="file"
            multiple
            className={styles.hiddenPicker}
            aria-label="Attach files"
            onChange={(event) => {
              uploadAll(event.target.files);
              // Cleared so choosing the same file twice in a row still fires.
              event.target.value = '';
            }}
          />

          {problem !== null && (
            <p className={styles.problem} role="alert">
              {problem}
            </p>
          )}
        </>
      )}
    </section>
  );
}

const UNITS = ['bytes', 'KB', 'MB', 'GB'] as const;

/** A size a person reads, not a number of bytes nobody counts. */
function formatBytes(bytes: number | null): string {
  if (bytes === null) {
    return '';
  }

  let size = bytes;
  let unit = 0;

  while (size >= 1024 && unit < UNITS.length - 1) {
    size /= 1024;
    unit += 1;
  }

  const rounded = unit === 0 ? size : Math.round(size * 10) / 10;

  return `${String(rounded)} ${UNITS[unit] ?? 'bytes'}`;
}
