import { useState, type DragEvent } from 'react';

export interface FileDrop {
  /** Spread onto whatever rectangle is meant to take the files. */
  readonly dropProps: {
    readonly onDragOver: (event: DragEvent) => void;
    readonly onDragLeave: () => void;
    readonly onDrop: (event: DragEvent) => void;
  };
  /** True while files are over it, so the target can say it is one. */
  readonly isOver: boolean;
}

/**
 * Makes a rectangle take dropped files.
 *
 * Dragging is how reference actually arrives — somebody has a folder open beside
 * the browser and four images in hand — so the target is the whole picture area
 * rather than a strip at the bottom of it.
 *
 * `types` is checked rather than `files`, because during a drag the browser will
 * not say what the files are, only that there are some. Dragging text or a link
 * over the sheet leaves it alone.
 */
export function useFileDrop(canWrite: boolean, onFiles: (files: FileList) => void): FileDrop {
  const [isOver, setIsOver] = useState(false);

  return {
    isOver,
    dropProps: {
      onDragOver: (event: DragEvent) => {
        if (canWrite && event.dataTransfer.types.includes('Files')) {
          // Without this the browser navigates to the file, which loses the page.
          event.preventDefault();
          setIsOver(true);
        }
      },
      onDragLeave: () => {
        setIsOver(false);
      },
      onDrop: (event: DragEvent) => {
        if (!canWrite) {
          return;
        }

        event.preventDefault();
        setIsOver(false);
        onFiles(event.dataTransfer.files);
      },
    },
  };
}
