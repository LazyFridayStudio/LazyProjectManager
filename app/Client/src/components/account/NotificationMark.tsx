import type { WaitingMention } from '@lpm/shared';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { Avatar } from '../ui/index.js';
import { joinClassNames } from '../../lib/join-class-names.js';
import { formatTimeAgo } from '../../logic/projects/format-project-values.js';
import { useSeeMention, useWaitingMentions } from '../../logic/auth/use-mentions.js';
import styles from './NotificationMark.module.css';

export interface NotificationMarkProps {
  /**
   * Which way the list falls open.
   *
   * The launcher's mark is in the header and the project sidebar's is at the
   * bottom of the screen, where a panel dropping down would fall off it. The
   * caller knows where it put this; the component cannot.
   */
  readonly opens: 'down' | 'up';
}

/**
 * What is waiting for you, beside your own face.
 *
 * Absent when nothing is, which is most of the time — a control that is always
 * there and usually says zero is a control people stop seeing. It appears
 * because somebody said your name, which is the only thing that puts anything
 * in it.
 *
 * Its own button rather than a badge on the account one, because they lead
 * different places: your face opens what you can change about yourself, and this
 * opens what other people have asked of you.
 */
export function NotificationMark({ opens }: NotificationMarkProps): React.JSX.Element | null {
  const waiting = useWaitingMentions();
  const [isOpen, setIsOpen] = useState(false);
  const total = waiting.data?.total ?? 0;

  if (total === 0) {
    return null;
  }

  return (
    <div className={styles.mark}>
      <button
        type="button"
        className={styles.circle}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={`${String(total)} waiting for you`}
        onClick={() => {
          setIsOpen((open) => !open);
        }}
      >
        {/* Past a point the number stops being a number and starts being "a
            lot", and three digits do not fit in a circle this size. */}
        {total > 99 ? '99+' : total}
      </button>

      {isOpen && (
        <Waiting
          opens={opens}
          mentions={waiting.data?.mentions ?? []}
          total={total}
          onDone={() => {
            setIsOpen(false);
          }}
        />
      )}
    </div>
  );
}

/**
 * The list under the circle.
 *
 * Each row is who said it, where, and enough of the sentence to know whether it
 * needs you now. Pressing one opens that card and takes it off the mark — the
 * two together, so the count goes down as the thing you were told about comes
 * into view.
 */
function Waiting({
  opens,
  mentions,
  total,
  onDone,
}: {
  readonly opens: 'down' | 'up';
  readonly mentions: readonly WaitingMention[];
  readonly total: number;
  readonly onDone: () => void;
}): React.JSX.Element {
  const navigate = useNavigate();
  const see = useSeeMention();

  return (
    <div
      className={joinClassNames(styles.panel, opens === 'up' ? styles.upwards : styles.downwards)}
      role="dialog"
      aria-label="Waiting for you"
    >
      {mentions.map((mention) => (
        <button
          key={mention.id}
          type="button"
          className={styles.waiting}
          onClick={() => {
            see.mutate(mention.id);
            onDone();
            void navigate({
              to: '/p/$slug/tasks',
              params: { slug: mention.projectSlug },
              search: { card: mention.cardId },
            });
          }}
        >
          <Avatar
            url={mention.said?.avatarUrl}
            initials={mention.said?.initials ?? '··'}
            className={styles.face}
          />

          <span className={styles.said}>
            <span className={styles.who}>
              {mention.said?.displayName ?? 'Somebody who has left'} · {mention.cardKey} ·{' '}
              {formatTimeAgo(mention.createdAt)}
            </span>
            <span className={styles.excerpt}>{mention.excerpt}</span>
          </span>
        </button>
      ))}

      {total > mentions.length && (
        <span className={styles.more}>{total - mentions.length} more, older than these.</span>
      )}
    </div>
  );
}
