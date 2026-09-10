import { joinClassNames } from '../../lib/join-class-names.js';
import type { MarkdownCommandName } from '../../logic/markdown/markdown-commands.js';
import styles from './MarkdownToolbar.module.css';

interface ToolbarButton {
  readonly command: MarkdownCommandName;
  readonly glyph: string;
  readonly label: string;
  /** Set on the glyph, so bold looks bold and struck text looks struck. */
  readonly style?: 'bold' | 'italic' | 'strikethrough' | 'code';
}

/**
 * Grouped by what they do to a line, to a word, and to a list, in that order —
 * the same order they are reached for.
 */
const GROUPS: readonly (readonly ToolbarButton[])[] = [
  [
    { command: 'heading1', glyph: 'H1', label: 'Heading 1' },
    { command: 'heading2', glyph: 'H2', label: 'Heading 2' },
    { command: 'heading3', glyph: 'H3', label: 'Heading 3' },
  ],
  [
    { command: 'bold', glyph: 'B', label: 'Bold (Ctrl+B)', style: 'bold' },
    { command: 'italic', glyph: 'I', label: 'Italic (Ctrl+I)', style: 'italic' },
    { command: 'strikethrough', glyph: 'S', label: 'Strikethrough', style: 'strikethrough' },
    { command: 'code', glyph: '‹›', label: 'Code', style: 'code' },
  ],
  [
    { command: 'bulletList', glyph: '•', label: 'Bulleted list' },
    { command: 'numberList', glyph: '1.', label: 'Numbered list' },
    { command: 'quote', glyph: '❝', label: 'Quote' },
  ],
  [{ command: 'link', glyph: '🔗', label: 'Link (Ctrl+K)' }],
];

export interface MarkdownToolbarProps {
  readonly onCommand: (command: MarkdownCommandName) => void;
  /** What is already true of the text under the caret, so a button can show it. */
  readonly active: ReadonlySet<MarkdownCommandName>;
}

/**
 * The buttons above a markdown box.
 *
 * They write markdown rather than hiding it: what a button does is visible in
 * the text the moment it is pressed, so the box stays something you can also
 * type into by hand.
 */
export function MarkdownToolbar({ onCommand, active }: MarkdownToolbarProps): React.JSX.Element {
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Formatting">
      {GROUPS.map((group) => (
        <div className={styles.group} key={group[0]?.command}>
          {group.map((button) => (
            <button
              key={button.command}
              type="button"
              className={joinClassNames(
                styles.button,
                button.style !== undefined && styles[button.style],
                active.has(button.command) && styles.buttonActive,
              )}
              title={button.label}
              aria-label={button.label}
              aria-pressed={active.has(button.command)}
              // Without this the box loses focus on the way down and the
              // selection the command is about to act on is already gone.
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => {
                onCommand(button.command);
              }}
            >
              {button.glyph}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
