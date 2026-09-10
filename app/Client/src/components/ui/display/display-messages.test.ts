import { describe, expect, it } from 'vitest';

import {
  addMessage,
  dismissMessage,
  lifetimeOf,
  MAXIMUM_SHOWN,
  type DisplayMessage,
} from './display-messages.js';

function message(id: string, text: string, tone: DisplayMessage['tone'] = 'info'): DisplayMessage {
  return { id, tone, text };
}

describe('GIVEN the messages on screen', () => {
  describe('WHEN one is added', () => {
    it('THEN it goes to the end, where the newest belongs', () => {
      const shown = addMessage([message('1', 'first')], message('2', 'second'));

      expect(shown.map((entry) => entry.text)).toEqual(['first', 'second']);
    });

    it('THEN the same words replace the first rather than stacking under it', () => {
      // Four source files dropped on the reference sheet is one thing that
      // happened, not four.
      const shown = [message('1', 'other'), message('2', 'left out')].reduce<
        readonly DisplayMessage[]
      >(addMessage, []);

      const afterRepeat = addMessage(shown, message('3', 'left out'));

      expect(afterRepeat.map((entry) => entry.text)).toEqual(['other', 'left out']);
      // The new one, so its life starts again and it stays while it keeps
      // happening.
      expect(afterRepeat.at(-1)?.id).toBe('3');
    });

    it('THEN the same words in a different tone are a different message', () => {
      const shown = addMessage([message('1', 'Upload failed.', 'info')], {
        id: '2',
        tone: 'error',
        text: 'Upload failed.',
      });

      expect(shown).toHaveLength(2);
    });

    it('THEN the oldest goes once the screen is full, rather than the list growing', () => {
      const shown = ['a', 'b', 'c', 'd', 'e'].reduce<readonly DisplayMessage[]>(
        (messages, text, index) => addMessage(messages, message(String(index), text)),
        [],
      );

      expect(shown).toHaveLength(MAXIMUM_SHOWN);
      expect(shown.map((entry) => entry.text)).toEqual(['c', 'd', 'e']);
    });
  });

  describe('WHEN one is dismissed', () => {
    it('THEN only that one goes', () => {
      const shown = dismissMessage([message('1', 'first'), message('2', 'second')], '1');

      expect(shown.map((entry) => entry.text)).toEqual(['second']);
    });

    it('THEN dismissing one that has already gone changes nothing', () => {
      const before = [message('1', 'first')];

      expect(dismissMessage(before, '9')).toEqual(before);
    });
  });

  describe('WHEN a message is waiting to take itself away', () => {
    it('THEN the worse it is the longer it stays, because it has more to be done about it', () => {
      expect(lifetimeOf('error')).toBeGreaterThan(lifetimeOf('warning'));
      expect(lifetimeOf('warning')).toBeGreaterThan(lifetimeOf('info'));
    });
  });
});
