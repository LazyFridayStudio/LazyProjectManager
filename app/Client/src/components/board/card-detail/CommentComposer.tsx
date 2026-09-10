import { MINIMUM_SEARCH_LENGTH, type CommentMark } from '@lpm/shared';
import { useLayoutEffect, useRef, useState } from 'react';

import { Avatar, Button } from '../../ui/index.js';
import {
  readMarkBeingTyped,
  replaceMarkBeingTyped,
  useMentionable,
  type MarkBeingTyped,
} from '../../../logic/board/card-detail/use-comment-marks.js';
import { useSuggestions } from '../../../logic/board/card-detail/use-card-search.js';
import styles from './CardActivity.module.css';

export interface CommentComposerProps {
  readonly projectId: string;
  readonly busy: boolean;
  readonly onPost: (body: string) => void;
}

/**
 * Where a remark is written, and where `@` and `#` are answered.
 *
 * The picker opens on the word being typed rather than on a button, because
 * that is how somebody writes the sentence: they are already saying "ask " when
 * they reach for the name. Choosing puts a mark into the text carrying the id of
 * whoever was picked, so the sentence still means the same person after they are
 * renamed.
 *
 * What is typed and never chosen stays exactly as typed. Most `@` in most
 * comments are an email address, and a box that mangled those would be a box
 * people stop using.
 */
export function CommentComposer({
  projectId,
  busy,
  onPost,
}: CommentComposerProps): React.JSX.Element {
  const [body, setBody] = useState('');
  const [caret, setCaret] = useState(0);
  const [caretToPutBack, setCaretToPutBack] = useState<number | null>(null);
  const box = useRef<HTMLInputElement>(null);

  const typed = readMarkBeingTyped(body, caret);

  /*
   * Back to the sentence, with the caret after the mark just chosen.
   *
   * In a layout effect rather than the next animation frame, which is where
   * this started and which lost a race it was always going to lose: a frame is
   * up to sixteen milliseconds away and somebody who has just picked a name is
   * already typing the rest of the line. The keystrokes in between went in
   * wherever the caret happened to be — at the front of the box, or into the
   * middle of the id the mark carries — and came out as
   * `can@[Alex Taylor](user:952ab…b you take the deck?5)`.
   *
   * A layout effect runs synchronously once React has put the new value in the
   * box, before the browser has painted and before it can deliver the next
   * keystroke, so there is no window to type into.
   */
  useLayoutEffect(() => {
    if (caretToPutBack === null) {
      return;
    }

    box.current?.focus();
    box.current?.setSelectionRange(caretToPutBack, caretToPutBack);
    setCaretToPutBack(null);
  }, [caretToPutBack]);

  const choose = (mark: CommentMark): void => {
    if (typed === null) {
      return;
    }

    const next = replaceMarkBeingTyped(body, typed, mark);

    setBody(next.body);
    setCaret(next.caret);
    setCaretToPutBack(next.caret);
  };

  const post = (): void => {
    if (body.trim() !== '') {
      onPost(body);
      setBody('');
      setCaret(0);
    }
  };

  const readCaret = (element: HTMLInputElement): void => {
    setCaret(element.selectionStart ?? element.value.length);
  };

  return (
    <>
      <input
        ref={box}
        type="text"
        className={styles.commentInput}
        aria-label="Add a comment"
        placeholder="Add a comment… @ somebody, # a card or an asset"
        value={body}
        onChange={(event) => {
          setBody(event.target.value);
          readCaret(event.target);
        }}
        // The caret decides which word the picker is on, and it moves without
        // the value changing — an arrow key, a click into the middle of a line.
        onKeyUp={(event) => {
          readCaret(event.currentTarget);
        }}
        onClick={(event) => {
          readCaret(event.currentTarget);
        }}
        onKeyDown={(event) => {
          // A remark is one line, so the key that ends a line posts it — unless
          // a picker is open, where Enter is how somebody would expect to take
          // the thing they are looking at rather than send half a sentence.
          if (event.key === 'Enter' && typed === null) {
            event.preventDefault();
            post();
          }

          if (event.key === 'Escape' && typed !== null) {
            // Closes the picker by ending the run, without losing what is typed.
            event.preventDefault();
            setCaret(0);
          }
        }}
      />

      {typed?.sigil === '@' && <WhoPicker projectId={projectId} typed={typed} onChoose={choose} />}

      {typed?.sigil === '#' && <WhatPicker projectId={projectId} typed={typed} onChoose={choose} />}

      {body.trim() !== '' && (
        <div className={styles.adder}>
          <Button tone="go" busy={busy} busyLabel="Posting…" onClick={post}>
            Comment
          </Button>
        </div>
      )}
    </>
  );
}

/** The people on this project, for an `@`. */
function WhoPicker({
  projectId,
  typed,
  onChoose,
}: {
  readonly projectId: string;
  readonly typed: MarkBeingTyped;
  readonly onChoose: (mark: CommentMark) => void;
}): React.JSX.Element {
  const people = useMentionable(projectId, typed);

  return (
    <Picker
      hint={
        people.people.length === 0 ? 'Nobody on this project by that name.' : 'Who do you mean?'
      }
      more={people.more}
    >
      {people.people.map((person) => (
        <button
          key={person.userId}
          type="button"
          className={styles.markSuggestion}
          onClick={() => {
            onChoose({ kind: 'user', id: person.userId, label: person.displayName });
          }}
        >
          <Avatar
            url={person.avatarUrl}
            initials={person.initials}
            className={styles.markSuggestionFace}
          />
          <span>{person.displayName}</span>
        </button>
      ))}
    </Picker>
  );
}

/**
 * The cards and assets in this project, for a `#`.
 *
 * The hint says the thing worth saying: naming a card in a remark is not the
 * same as linking it, and somebody reaching for `#` may well expect it to be.
 */
function WhatPicker({
  projectId,
  typed,
  onChoose,
}: {
  readonly projectId: string;
  readonly typed: MarkBeingTyped;
  readonly onChoose: (mark: CommentMark) => void;
}): React.JSX.Element {
  const things = useSuggestions(projectId, typed.query);

  return (
    <Picker
      hint={
        typed.query.length < MINIMUM_SEARCH_LENGTH
          ? 'Keep typing to find a card or an asset.'
          : 'Naming it here does not link it.'
      }
      more={0}
    >
      {things.cards.map((card) => (
        <button
          key={card.id}
          type="button"
          className={styles.markSuggestion}
          onClick={() => {
            onChoose({ kind: 'card', id: card.id, label: card.cardKey });
          }}
        >
          <span className={styles.markSuggestionKey}>{card.cardKey}</span>
          <span>{card.title}</span>
        </button>
      ))}

      {things.assets.map((asset) => (
        <button
          key={asset.id}
          type="button"
          className={styles.markSuggestion}
          onClick={() => {
            onChoose({ kind: 'asset', id: asset.id, label: asset.assetKey });
          }}
        >
          <span className={styles.markSuggestionKey}>{asset.assetKey}</span>
          <span>{asset.name}</span>
        </button>
      ))}
    </Picker>
  );
}

/**
 * The list under the box, and the line that says what it is for.
 *
 * The hint is always there, including when there is nothing to show: a picker
 * that opens empty and says nothing reads as broken, and the `#` one says the
 * thing worth saying — that naming a card here is not the same as linking it.
 */
function Picker({
  hint,
  more,
  children,
}: {
  readonly hint: string;
  readonly more: number;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={styles.markPicker}>
      <span className={styles.markPickerHint}>{hint}</span>
      {children}
      {more > 0 && (
        <span className={styles.markPickerHint}>{more} more — keep typing to narrow it.</span>
      )}
    </div>
  );
}
