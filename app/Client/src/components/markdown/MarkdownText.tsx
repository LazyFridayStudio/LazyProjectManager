import { useMemo } from 'react';

import styles from './MarkdownText.module.css';
import { renderMarkdown } from '../../logic/markdown/render-markdown.js';

/**
 * A description as it reads, rather than as it was typed.
 *
 * The HTML is sanitised in `renderMarkdown` before it gets here, which is what
 * makes setting it directly acceptable — a description is text one person
 * writes and others read, and that is the shape of every stored scripting bug
 * there has ever been.
 */
export function MarkdownText({ source }: { source: string }): React.JSX.Element {
  const html = useMemo(() => renderMarkdown(source), [source]);

  return (
    <div
      className={styles.markdown}
      // Sanitised on the line above; see `renderMarkdown`.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
