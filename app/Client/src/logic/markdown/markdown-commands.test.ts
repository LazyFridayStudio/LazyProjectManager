import { describe, expect, it } from 'vitest';

import {
  activeMarkdownCommands,
  applyMarkdownCommand,
  type MarkdownCommandName,
  type TextSelection,
} from './markdown-commands.js';

/**
 * Writes the caret as `|` and a selection as `[...]`, so a case reads as what
 * is on screen rather than as a pair of offsets counted by hand.
 */
function caret(marked: string): { text: string; selection: TextSelection } {
  const insertion = marked.indexOf('|');

  if (insertion !== -1) {
    return { text: marked.replace('|', ''), selection: { start: insertion, end: insertion } };
  }

  const start = marked.indexOf('[');
  const end = marked.indexOf(']') - 1;

  return { text: marked.replace('[', '').replace(']', ''), selection: { start, end } };
}

function run(command: MarkdownCommandName, marked: string): string {
  const { text, selection } = caret(marked);
  const edit = applyMarkdownCommand(command, text, selection);

  return edit.text;
}

describe('GIVEN a description being written', () => {
  describe('WHEN bold is pressed with words selected', () => {
    it('THEN the words are wrapped and stay selected', () => {
      const { text, selection } = caret('a [big] wall');

      const edit = applyMarkdownCommand('bold', text, selection);

      expect(edit.text).toBe('a **big** wall');
      expect(edit.text.slice(edit.selection.start, edit.selection.end)).toBe('big');
    });

    it('THEN pressing it again takes it off', () => {
      expect(run('bold', 'a **[big]** wall')).toBe('a big wall');
      expect(run('bold', 'a [**big**] wall')).toBe('a big wall');
    });
  });

  describe('WHEN bold is pressed with nothing selected', () => {
    it('THEN the pair is written and the caret left between them', () => {
      const { text, selection } = caret('a | wall');

      const edit = applyMarkdownCommand('bold', text, selection);

      expect(edit.text).toBe('a **** wall');
      expect(edit.selection).toEqual({ start: 4, end: 4 });
    });
  });

  describe('WHEN italic is pressed inside bold text', () => {
    it('THEN it adds its own marks rather than eating one of bold', () => {
      // `_` and `**` cannot be mistaken for each other, which `*` and `**` can.
      expect(run('italic', '**[big]**')).toBe('**_big_**');
    });
  });

  describe('WHEN a heading is pressed', () => {
    it('THEN the line the caret is on becomes one', () => {
      expect(run('heading2', 'Some| line')).toBe('## Some line');
    });

    it('THEN a line already at that level goes back to being prose', () => {
      expect(run('heading2', '## Some| line')).toBe('Some line');
    });

    it('THEN a line at another level changes level rather than gaining a mark', () => {
      expect(run('heading3', '# Some| line')).toBe('### Some line');
    });

    it('THEN a list becomes a heading, because a line cannot be both', () => {
      expect(run('heading1', '- Some| line')).toBe('# Some line');
    });

    it('THEN the caret keeps its place in the words', () => {
      const { text, selection } = caret('Some| line');

      const edit = applyMarkdownCommand('heading2', text, selection);

      expect(edit.text.slice(0, edit.selection.start)).toBe('## Some');
    });
  });

  describe('WHEN a list is made of several lines', () => {
    it('THEN every selected line is marked', () => {
      expect(run('bulletList', '[one\ntwo\nthree]')).toBe('- one\n- two\n- three');
    });

    it('THEN a numbered list counts up', () => {
      expect(run('numberList', '[one\ntwo\nthree]')).toBe('1. one\n2. two\n3. three');
    });

    it('THEN pressing it again clears every line', () => {
      expect(run('bulletList', '[- one\n- two]')).toBe('one\ntwo');
    });

    it('THEN a mark still missing from one line is added to all of them', () => {
      expect(run('bulletList', '[- one\ntwo]')).toBe('- one\n- two');
    });

    it('THEN the changed lines are what stays selected', () => {
      const { text, selection } = caret('[one\ntwo]');

      const edit = applyMarkdownCommand('bulletList', text, selection);

      expect(edit.text.slice(edit.selection.start, edit.selection.end)).toBe('- one\n- two');
    });
  });

  describe('WHEN a line is quoted', () => {
    it('THEN the quote sits outside the list mark, because both can be true', () => {
      expect(run('quote', '- one|')).toBe('> - one');
    });

    it('THEN pressing it again unquotes it', () => {
      expect(run('quote', '> - one|')).toBe('- one');
    });
  });

  describe('WHEN a link is inserted', () => {
    it('THEN selected words become the caption and the address is left to type', () => {
      const { text, selection } = caret('see [the plan] for more');

      const edit = applyMarkdownCommand('link', text, selection);

      expect(edit.text).toBe('see [the plan](https://) for more');
      expect(edit.text.slice(edit.selection.start, edit.selection.end)).toBe('https://');
    });

    it('THEN a selected address becomes the target and the caption is left to type', () => {
      const { text, selection } = caret('[https://example.com/plan]');

      const edit = applyMarkdownCommand('link', text, selection);

      expect(edit.text).toBe('[link text](https://example.com/plan)');
      expect(edit.text.slice(edit.selection.start, edit.selection.end)).toBe('link text');
    });

    it('THEN nothing selected still writes a link worth filling in', () => {
      expect(run('link', 'see |')).toBe('see [link text](https://)');
    });
  });

  describe('WHEN the caret is somewhere in the text', () => {
    it('THEN the buttons already true of it are on', () => {
      const { text, selection } = caret('## A hea|ding');

      expect([...activeMarkdownCommands(text, selection)]).toEqual(['heading2']);
    });

    it('THEN a quoted list reports both', () => {
      const { text, selection } = caret('> - one|');

      const active = activeMarkdownCommands(text, selection);

      expect(active.has('bulletList')).toBe(true);
      expect(active.has('quote')).toBe(true);
    });

    it('THEN wrapped words report their marks whichever side of the selection they are on', () => {
      expect(activeMarkdownCommands(...values(caret('a **[big]** wall'))).has('bold')).toBe(true);
      expect(activeMarkdownCommands(...values(caret('a [**big**] wall'))).has('bold')).toBe(true);
    });

    it('THEN plain prose reports nothing', () => {
      const { text, selection } = caret('just wo|rds');

      expect(activeMarkdownCommands(text, selection).size).toBe(0);
    });
  });
});

function values(parsed: { text: string; selection: TextSelection }): [string, TextSelection] {
  return [parsed.text, parsed.selection];
}
