import type { UploadTarget } from '@lpm/shared';
import { useState, type ChangeEvent, type DragEvent } from 'react';

import { useApiClient } from '../ApiClientProvider.js';
import { joinClassNames } from '../../lib/join-class-names.js';
import { MarkdownEditorPreview } from './MarkdownEditorPreview.js';
import { MarkdownToolbar } from './MarkdownToolbar.js';
import { useMarkdownCommands, writeImageMarkdown } from '../../logic/markdown/index.js';
import { uploadFile } from '../../logic/files/upload-file.js';
import {
  readDraggedAttachment,
  ATTACHMENT_MEDIA_TYPE,
} from '../../logic/board/card-detail/attachment-drag.js';
import styles from './MarkdownField.module.css';

type Mode = 'raw' | 'preview';

const MODES: readonly { value: Mode; label: string }[] = [
  { value: 'raw', label: 'Raw' },
  { value: 'preview', label: 'Preview' },
];

/**
 * Where a dropped file goes, and how the line pointing at it is written in.
 *
 * One prop rather than two, because half of it is no use: somewhere to put a
 * file and no way to write it in leaves an upload nothing points at.
 */
export interface MarkdownFieldFiles {
  readonly uploadTo: UploadTarget;
  readonly onInsert: (markdown: string) => void;
}

export interface MarkdownFieldProps {
  readonly label: string;
  readonly className: string;
  readonly value: string;
  /** What to write here, for a box short enough that the prompt is the label. */
  readonly placeholder?: string;
  /** Left off where there is nowhere to put a file, and then nothing drops. */
  readonly files?: MarkdownFieldFiles;
  readonly onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  /** Used by the toolbar and by the preview, which rewrite rather than type. */
  readonly onReplace: (source: string) => void;
}

/**
 * A markdown box with tools above it, showing either what was typed or what it
 * will look like.
 *
 * The tools write markdown rather than hiding it — press bold and the asterisks
 * appear — so the box stays something you can type into by hand, and what is
 * saved is the same text whichever way it was written.
 *
 * Two kinds of drop land here and both end as the same line of markdown. A file
 * from the desktop is uploaded and then written in; a file already on the card,
 * dragged out of the Files list, is written in without being uploaded twice.
 *
 * What a dropped file is attached to is the caller's to say, because the same
 * box writes a card's description and an asset's.
 */
export function MarkdownField({
  label,
  className,
  value,
  placeholder,
  files,
  onChange,
  onReplace,
}: MarkdownFieldProps): React.JSX.Element {
  const { client } = useApiClient();
  const commands = useMarkdownCommands(value, onReplace);
  const [mode, setMode] = useState<Mode>('raw');
  const [isOver, setIsOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    if (files === undefined) {
      return;
    }

    event.preventDefault();
    setIsOver(false);

    const attached = readDraggedAttachment(event.dataTransfer.getData(ATTACHMENT_MEDIA_TYPE));

    if (attached !== null) {
      // Already on the card: it only needs writing in.
      files.onInsert(writeImageMarkdown(attached.filename, `/api/f/${attached.fileId}`));
      return;
    }

    void uploadDropped(files, event.dataTransfer.files);
  };

  const uploadDropped = async (where: MarkdownFieldFiles, dropped: FileList): Promise<void> => {
    setIsUploading(true);

    try {
      for (const file of dropped) {
        const fileId = await uploadFile(client, where.uploadTo, file);
        where.onInsert(writeImageMarkdown(file.name, `/api/f/${fileId}`));
      }
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div
      className={styles.field}
      onDragOver={(event) => {
        if (files === undefined) {
          return;
        }

        // Without this the browser opens the file, losing what is on screen.
        event.preventDefault();
        setIsOver(true);
      }}
      onDragLeave={(event) => {
        // Crossing into the box, or onto a button, is not leaving the field.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsOver(false);
        }
      }}
      onDrop={onDrop}
    >
      <div className={styles.modes} role="tablist" aria-label={`${label} view`}>
        {MODES.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={mode === option.value}
            className={joinClassNames(styles.mode, mode === option.value && styles.modeSelected)}
            onClick={() => {
              setMode(option.value);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>

      {mode === 'raw' ? (
        <>
          <MarkdownToolbar onCommand={commands.run} active={commands.active} />
          <textarea
            ref={commands.box}
            className={joinClassNames(className, isOver && styles.over)}
            aria-label={label}
            placeholder={placeholder}
            value={value}
            onChange={onChange}
            onKeyDown={commands.onKeyDown}
            onSelect={commands.onSelect}
          />
        </>
      ) : (
        <div className={joinClassNames(className, styles.previewBox, isOver && styles.over)}>
          <MarkdownEditorPreview source={value} onChange={onReplace} />
        </div>
      )}

      {isUploading && <p className={styles.status}>Uploading…</p>}
    </div>
  );
}
