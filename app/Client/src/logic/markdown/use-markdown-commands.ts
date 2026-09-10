import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
  type SyntheticEvent,
} from 'react';

import {
  activeMarkdownCommands,
  applyMarkdownCommand,
  type MarkdownCommandName,
  type TextSelection,
} from './markdown-commands.js';

/** What a keystroke means, so a shortcut and a button run the same command. */
const SHORTCUTS: Readonly<Record<string, MarkdownCommandName>> = {
  b: 'bold',
  i: 'italic',
  k: 'link',
};

export interface MarkdownCommands {
  /** Put on the text box the commands act through. */
  readonly box: RefObject<HTMLTextAreaElement | null>;
  /** What is already true of the text under the caret. */
  readonly active: ReadonlySet<MarkdownCommandName>;
  readonly run: (command: MarkdownCommandName) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  readonly onSelect: (event: SyntheticEvent<HTMLTextAreaElement>) => void;
}

/**
 * Runs the toolbar's commands against a text box, and puts the caret back.
 *
 * The editing itself is in `markdown-commands`, which knows nothing about the
 * page; this is only the part that has to — where the caret is, and where it
 * should be once the new text has arrived.
 */
export function useMarkdownCommands(
  value: string,
  onReplace: (source: string) => void,
): MarkdownCommands {
  const box = useRef<HTMLTextAreaElement>(null);
  // Set by a command, read back once the new text has reached the box.
  const pending = useRef<TextSelection | null>(null);
  const [selection, setSelection] = useState<TextSelection>({ start: 0, end: 0 });

  // A command decides what should be selected afterwards, but the text has to be
  // on screen before the box can be told. Laid out rather than painted, so the
  // caret is never seen in the old place first.
  useLayoutEffect(() => {
    const node = box.current;
    const next = pending.current;

    if (node === null || next === null) {
      return;
    }

    pending.current = null;
    node.focus();
    node.setSelectionRange(next.start, next.end);
    setSelection(next);
  }, [value]);

  const run = (command: MarkdownCommandName): void => {
    const node = box.current;

    if (node === null) {
      return;
    }

    const edit = applyMarkdownCommand(command, value, {
      start: node.selectionStart,
      end: node.selectionEnd,
    });

    pending.current = edit.selection;
    onReplace(edit.text);
  };

  return {
    box,
    active: activeMarkdownCommands(value, selection),
    run,

    onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      const command = SHORTCUTS[event.key.toLowerCase()];

      if (command === undefined || !(event.ctrlKey || event.metaKey) || event.altKey) {
        return;
      }

      event.preventDefault();
      run(command);
    },

    onSelect: (event: SyntheticEvent<HTMLTextAreaElement>): void => {
      setSelection({
        start: event.currentTarget.selectionStart,
        end: event.currentTarget.selectionEnd,
      });
    },
  };
}
