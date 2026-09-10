/**
 * What the toolbar buttons do, as text in and text out.
 *
 * Nothing here touches the page. A command is a function of what is written and
 * where the caret is, which is what lets it be tested against a string rather
 * than against a browser — and it keeps the markdown the only place anything is
 * stored, so a button and a keyboard shortcut cannot disagree.
 */

export type MarkdownCommandName =
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'code'
  | 'bulletList'
  | 'numberList'
  | 'quote'
  | 'link';

/** Where the caret is, or what it has hold of. */
export interface TextSelection {
  readonly start: number;
  readonly end: number;
}

export interface MarkdownEdit {
  readonly text: string;
  readonly selection: TextSelection;
}

/**
 * `_` for italic rather than `*`, so that one pair can never be read as half of
 * the other: `**bold**` with a `*` italic is ambiguous to a person and to the
 * code that has to decide whether a button is already on.
 */
const WRAPPERS = {
  bold: '**',
  italic: '_',
  strikethrough: '~~',
  code: '`',
} as const;

type WrapCommand = keyof typeof WRAPPERS;

/**
 * What can start a line.
 *
 * A heading and a list marker share one slot — `# - a` is neither — so applying
 * one takes the other off. A quote sits outside that slot and toggles on its
 * own, because a quoted list is a real thing to want.
 */
const MARKERS = {
  heading1: '# ',
  heading2: '## ',
  heading3: '### ',
  bulletList: '- ',
} as const;

type LineCommand = keyof typeof MARKERS | 'numberList' | 'quote';

const QUOTE = /^>\s?/;
const MARKER = /^(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+)/;
const NUMBER = /^\d+\.\s+/;
const BULLET = /^[-*+]\s+/;

/** Enough of a URL to tell a web address from a caption. */
const URL_LIKE = /^(?:https?:\/\/|mailto:|\/)\S*$/;

const LINK_LABEL = 'link text';
const LINK_URL = 'https://';

/** Applies one toolbar button, and says what should be selected afterwards. */
export function applyMarkdownCommand(
  command: MarkdownCommandName,
  text: string,
  selection: TextSelection,
): MarkdownEdit {
  if (command === 'link') {
    return applyLink(text, selection);
  }

  return isWrapCommand(command)
    ? applyWrap(command, text, selection)
    : applyLineCommand(command, text, selection);
}

/**
 * Which buttons are already on where the caret is.
 *
 * A toolbar that cannot say what the text already is leaves you pressing bold
 * to find out, and undoing it when the answer is yes.
 */
export function activeMarkdownCommands(
  text: string,
  selection: TextSelection,
): ReadonlySet<MarkdownCommandName> {
  const caret = { start: selection.start, end: selection.start };
  const range = lineRange(text, caret);
  const line = parseLine(text.slice(range.start, range.end));
  const active = new Set<MarkdownCommandName>();

  for (const command of ['heading1', 'heading2', 'heading3', 'bulletList', 'numberList', 'quote']) {
    if (lineHas(command as LineCommand, line)) {
      active.add(command as MarkdownCommandName);
    }
  }

  for (const command of Object.keys(WRAPPERS) as WrapCommand[]) {
    if (isWrapped(text, selection, WRAPPERS[command])) {
      active.add(command);
    }
  }

  return active;
}

function isWrapCommand(command: MarkdownCommandName): command is WrapCommand {
  return command in WRAPPERS;
}

/**
 * Puts a pair of markers around the selection, or takes them off again.
 *
 * With nothing selected the pair is still written and the caret left between
 * them, which is how you turn bold on before typing rather than after.
 */
function applyWrap(command: WrapCommand, text: string, selection: TextSelection): MarkdownEdit {
  const marker = WRAPPERS[command];
  const selected = text.slice(selection.start, selection.end);

  if (wrapsSelection(text, selection, marker)) {
    return {
      text: `${text.slice(0, selection.start - marker.length)}${selected}${text.slice(selection.end + marker.length)}`,
      selection: {
        start: selection.start - marker.length,
        end: selection.end - marker.length,
      },
    };
  }

  if (isInsideSelection(selected, marker)) {
    const inner = selected.slice(marker.length, -marker.length);

    return {
      text: `${text.slice(0, selection.start)}${inner}${text.slice(selection.end)}`,
      selection: { start: selection.start, end: selection.start + inner.length },
    };
  }

  return {
    text: `${text.slice(0, selection.start)}${marker}${selected}${marker}${text.slice(selection.end)}`,
    selection: {
      start: selection.start + marker.length,
      end: selection.start + marker.length + selected.length,
    },
  };
}

function isWrapped(text: string, selection: TextSelection, marker: string): boolean {
  return (
    wrapsSelection(text, selection, marker) ||
    isInsideSelection(text.slice(selection.start, selection.end), marker)
  );
}

/** The markers are just outside what is selected: `**[bold]**`. */
function wrapsSelection(text: string, selection: TextSelection, marker: string): boolean {
  return (
    selection.start >= marker.length &&
    text.slice(selection.start - marker.length, selection.start) === marker &&
    text.slice(selection.end, selection.end + marker.length) === marker
  );
}

/** The markers are part of what is selected: `[**bold**]`. */
function isInsideSelection(selected: string, marker: string): boolean {
  return (
    selected.length >= marker.length * 2 && selected.startsWith(marker) && selected.endsWith(marker)
  );
}

/**
 * Sets, or clears, what starts each line the selection touches.
 *
 * Pressing a button whose mark is already on every line takes it off, so one
 * button is both "make this a heading" and "stop it being one".
 */
function applyLineCommand(
  command: LineCommand,
  text: string,
  selection: TextSelection,
): MarkdownEdit {
  const range = lineRange(text, selection);
  const lines = text.slice(range.start, range.end).split('\n').map(parseLine);
  const clearing = lines.every((line) => lineHas(command, line));

  const written = lines
    .map((line, index) =>
      writeLine(
        command === 'quote'
          ? { ...line, quoted: !clearing }
          : { ...line, marker: clearing ? '' : markerFor(command, index) },
      ),
    )
    .join('\n');

  return {
    text: `${text.slice(0, range.start)}${written}${text.slice(range.end)}`,
    selection: selectionAfter({ selection, range, lines, written }),
  };
}

/**
 * A caret stays where it was, a selection grows to the lines it changed.
 *
 * Reselecting the whole line under a caret would lose the place you were typing;
 * holding a selection to its original bounds would leave the new marks half in
 * and half out of it.
 */
interface Rewrite {
  readonly selection: TextSelection;
  readonly range: TextSelection;
  readonly lines: readonly ParsedLine[];
  readonly written: string;
}

function selectionAfter({ selection, range, lines, written }: Rewrite): TextSelection {
  if (selection.start !== selection.end) {
    return { start: range.start, end: range.start + written.length };
  }

  const before = writeLine(lines[0] ?? { quoted: false, marker: '', content: '' });
  const shift = (written.split('\n')[0] ?? '').length - before.length;
  const caret = Math.max(range.start, selection.start + shift);

  return { start: caret, end: caret };
}

function markerFor(command: LineCommand, index: number): string {
  if (command === 'numberList') {
    return `${String(index + 1)}. `;
  }

  return command === 'quote' ? '' : MARKERS[command];
}

function lineHas(command: LineCommand, line: ParsedLine): boolean {
  if (command === 'quote') {
    return line.quoted;
  }

  if (command === 'numberList') {
    return NUMBER.test(line.marker);
  }

  if (command === 'bulletList') {
    return BULLET.test(line.marker);
  }

  return line.marker.trimEnd() === MARKERS[command].trimEnd();
}

interface ParsedLine {
  readonly quoted: boolean;
  readonly marker: string;
  readonly content: string;
}

function parseLine(line: string): ParsedLine {
  const quote = QUOTE.exec(line);
  const rest = quote === null ? line : line.slice(quote[0].length);
  const marker = MARKER.exec(rest);

  return {
    quoted: quote !== null,
    marker: marker?.[0] ?? '',
    content: marker === null ? rest : rest.slice(marker[0].length),
  };
}

function writeLine(line: ParsedLine): string {
  return `${line.quoted ? '> ' : ''}${line.marker}${line.content}`;
}

/** Grows a selection out to the whole of every line it touches. */
function lineRange(text: string, selection: TextSelection): TextSelection {
  // A selection that ends on a newline has not reached the line after it.
  const last =
    selection.end > selection.start && text[selection.end - 1] === '\n'
      ? selection.end - 1
      : selection.end;
  const after = text.indexOf('\n', last);

  return {
    start: text.lastIndexOf('\n', selection.start - 1) + 1,
    end: after === -1 ? text.length : after,
  };
}

/**
 * Writes a link, leaving the part you still have to type selected.
 *
 * A web address that is already selected becomes the target rather than the
 * caption, because pasting an address and pressing the button is how a link
 * usually gets made.
 */
function applyLink(text: string, selection: TextSelection): MarkdownEdit {
  const selected = text.slice(selection.start, selection.end);
  const isAddress = URL_LIKE.test(selected);
  const label = isAddress || selected === '' ? LINK_LABEL : selected;
  const url = isAddress ? selected : LINK_URL;
  const written = `[${label}](${url})`;

  // `[` is one character, and `](` two.
  const typeOver =
    isAddress || selected === ''
      ? { start: selection.start + 1, length: label.length }
      : { start: selection.start + label.length + 3, length: url.length };

  return {
    text: `${text.slice(0, selection.start)}${written}${text.slice(selection.end)}`,
    selection: { start: typeOver.start, end: typeOver.start + typeOver.length },
  };
}
