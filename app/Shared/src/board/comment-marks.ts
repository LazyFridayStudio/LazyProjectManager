import { z } from 'zod';

/**
 * What a comment can point at, and how it is written down.
 *
 * A remark says a name and a key: *"@Alex Taylor the deck in #EXMP-ART-4 is
 * wrong"*. Both should be worth pressing, and neither should mean anything more
 * than that somebody said it.
 *
 * ## Why the id is in the text
 *
 * A mark carries the id of the thing it names as well as what it was called at
 * the time:
 *
 * ```
 * @[Alex Taylor](user:018f…)    #[EXMP-ART-4](card:018f…)
 * ```
 *
 * The alternative is to store `@Alex Taylor` and work out who that was when it
 * is drawn. That reads better raw and is wrong in two ways nobody can fix
 * afterwards: two people called Alex are one name, and a person who changes
 * their name breaks every remark that ever mentioned them. An id decided once,
 * when there was a picker on screen and somebody chose from it, is the only
 * moment anybody actually knows who was meant.
 *
 * Keeping the label too is what makes a comment still readable in a database
 * dump, in the audit trail, or anywhere else that has not been taught this.
 *
 * ## Why `#` is not a link
 *
 * The board has real links between cards — `blocks`, `relates`, `duplicates`,
 * gathering under a legend. Those are statements about the work: they show on
 * both cards, they mean something to the schedule, and somebody manages them.
 *
 * A `#` in a comment is not one of those. It is a person writing a sentence
 * that happens to name something. If it quietly made a link, every passing
 * mention would become a permanent claim somebody else has to tidy up — so this
 * writes nothing to `card_link`, and never will.
 */

export const COMMENT_MARK_KINDS = ['user', 'card', 'asset'] as const;

export type CommentMarkKind = (typeof COMMENT_MARK_KINDS)[number];

export const commentMarkKindSchema = z.enum(COMMENT_MARK_KINDS);

/** A person named, or a card or asset pointed at, inside a comment. */
export interface CommentMark {
  readonly kind: CommentMarkKind;
  readonly id: string;
  /** What it was called when somebody chose it. */
  readonly label: string;
}

/**
 * One run of a comment: something to read, or something to press.
 *
 * The mark's own kind is `markKind` rather than `kind`, which is the price of
 * the outer union using that word already. Naming it twice would be worse.
 */
export type CommentPiece =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'mark';
      readonly markKind: CommentMarkKind;
      readonly id: string;
      readonly label: string;
    };

/**
 * `@[Alex Taylor](user:018f…)` and `#[EXMP-ART-4](card:018f…)`.
 *
 * The sigil decides nothing on its own — the kind inside the brackets does — but
 * it has to be there, so that an ordinary markdown link somebody pasted is not
 * read as a mention.
 */
const MARK = /([@#])\[([^\]]{1,120})\]\((user|card|asset):([0-9a-fA-F-]{36})\)/gu;

/** The sigil each kind is written with, which is what somebody types to start one. */
export const SIGIL_BY_KIND: Readonly<Record<CommentMarkKind, string>> = {
  user: '@',
  card: '#',
  asset: '#',
};

/**
 * Writes one mark, ready to drop into what somebody is typing.
 *
 * The label loses the brackets that would end it early, and the gap they leave
 * closes up. A person called `A]B` is not a real person and a card key cannot
 * hold one — but a comment is a text box, and this is the one place a stray
 * bracket would turn a mark into something that reads as a mark and is not one.
 */
export function writeCommentMark(mark: CommentMark): string {
  const label = mark.label
    .replace(/[[\]()]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

  return `${SIGIL_BY_KIND[mark.kind]}[${label}](${mark.kind}:${mark.id})`;
}

/**
 * Splits a comment into what to read and what to press.
 *
 * One pass, and everything that is not a mark comes back as text — including a
 * `@` somebody typed and never finished, which is the common case and must
 * survive exactly as written.
 */
export function readComment(body: string): CommentPiece[] {
  const pieces: CommentPiece[] = [];
  let readTo = 0;

  for (const found of body.matchAll(MARK)) {
    const [whole, sigil, label, kind, id] = found;

    // A `#` naming a person, or an `@` naming a card, is somebody typing rather
    // than something chosen. Left as the text it is.
    if (sigil !== SIGIL_BY_KIND[kind as CommentMarkKind]) {
      continue;
    }

    if (found.index > readTo) {
      pieces.push({ kind: 'text', text: body.slice(readTo, found.index) });
    }

    pieces.push({
      kind: 'mark',
      markKind: kind as CommentMarkKind,
      id: id ?? '',
      label: label ?? '',
    });

    readTo = found.index + whole.length;
  }

  if (readTo < body.length) {
    pieces.push({ kind: 'text', text: body.slice(readTo) });
  }

  return pieces;
}

/** Everybody named in a comment, once each, in the order they were named. */
export function readMentionedUserIds(body: string): string[] {
  const named = new Set<string>();

  for (const piece of readComment(body)) {
    if (piece.kind === 'mark' && piece.markKind === 'user') {
      named.add(piece.id);
    }
  }

  return [...named];
}

/**
 * A comment with its marks written out as the words they stand for.
 *
 * For anywhere that has no idea what a mark is and should not be taught — the
 * line under a notification, an excerpt, anything read rather than pressed.
 */
export function readCommentAsText(body: string): string {
  return readComment(body)
    .map((piece) =>
      piece.kind === 'text' ? piece.text : `${SIGIL_BY_KIND[piece.markKind]}${piece.label}`,
    )
    .join('');
}
