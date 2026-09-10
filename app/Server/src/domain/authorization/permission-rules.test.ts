import { describe, expect, it } from 'vitest';

import {
  CATALOGUES,
  catalogueOf,
  catalogues,
  decide,
  describeRule,
  isRuleSubject,
} from './permission-rules.js';
import { permittedActions } from './permitted-actions.js';

describe('GIVEN a set of permission rules', () => {
  describe('WHEN nothing in it names the action', () => {
    it('THEN it says nothing rather than refusing', () => {
      // Not a denial: the caller falls back to the role ladder, which is what
      // lets an install with no groups behave exactly as it did before.
      expect(decide([], 'card.move')).toBeUndefined();
      expect(decide([{ action: 'card.comment', effect: 'allow' }], 'card.move')).toBeUndefined();
    });
  });

  describe('WHEN one rule names the action', () => {
    it('THEN that is the answer, either way', () => {
      expect(decide([{ action: 'card.move', effect: 'allow' }], 'card.move')).toBe('allow');
      expect(decide([{ action: 'card.move', effect: 'deny' }], 'card.move')).toBe('deny');
    });
  });

  describe('WHEN two rules disagree about the same action', () => {
    it('THEN deny wins', () => {
      // Somebody in two teams, one of which allows. The safe half of a
      // contradiction is the one that refuses.
      const rules = [
        { action: 'card.move', effect: 'allow' as const },
        { action: 'card.move', effect: 'deny' as const },
      ];

      expect(decide(rules, 'card.move')).toBe('deny');
    });
  });

  describe('WHEN a group given to the person disagrees with one their team holds', () => {
    it('THEN the one given to them wins, allowing where the team is denied', () => {
      // An artist personally allowed to record a release, on a team that is
      // not. The specific statement is the one that was made about them.
      const rules = [
        { action: 'release.record', effect: 'deny' as const, source: 'team' as const },
        { action: 'release.record', effect: 'allow' as const, source: 'person' as const },
      ];

      expect(decide(rules, 'release.record')).toBe('allow');
    });

    it('THEN the one given to them wins the other way too, which is the half worth checking', () => {
      // A contractor on a team that may delete cards, personally denied it.
      // An override that only ever widened would be no override at all.
      const rules = [
        { action: 'card.delete', effect: 'allow' as const, source: 'team' as const },
        { action: 'card.delete', effect: 'deny' as const, source: 'person' as const },
      ];

      expect(decide(rules, 'card.delete')).toBe('deny');
    });

    it('THEN saying nothing is not a statement, so the team is read as it always was', () => {
      // Somebody holds a group of their own that is about something else
      // entirely. Silence is not permission, and it is not refusal either.
      const rules = [
        { action: 'card.move', effect: 'deny' as const, source: 'team' as const },
        { action: 'release.record', effect: 'allow' as const, source: 'person' as const },
      ];

      expect(decide(rules, 'card.move')).toBe('deny');
    });
  });

  describe('WHEN two groups given to the same person disagree', () => {
    it('THEN deny wins between them, because nothing distinguishes the two', () => {
      const rules = [
        { action: 'card.move', effect: 'allow' as const, source: 'person' as const },
        { action: 'card.move', effect: 'deny' as const, source: 'person' as const },
      ];

      expect(decide(rules, 'card.move')).toBe('deny');
    });
  });

  describe('WHEN a rule does not say where it came from', () => {
    it('THEN it is read as a team’s, which is the weaker of the two', () => {
      // Every rule that predates sources, and anything a future build writes
      // that this one does not recognise. An unknown source must not be a way
      // to outrank a team.
      const rules = [
        { action: 'card.move', effect: 'allow' as const },
        { action: 'card.move', effect: 'deny' as const, source: 'team' as const },
      ];

      expect(decide(rules, 'card.move')).toBe('deny');
    });
  });

  describe('WHEN a catalogue name reaches it somehow', () => {
    it('THEN it means nothing, because a catalogue is never stored', () => {
      /*
       * The property the whole redesign rests on. A heading that could also be
       * a rule is a heading that can disagree with what is under it, and then
       * the screen has to explain a precedence. This one is only ever a summary.
       */
      expect(decide([{ action: 'catalog.board', effect: 'allow' }], 'card.move')).toBeUndefined();
      expect(isRuleSubject('catalog.board')).toBe(false);
    });
  });
});

describe('GIVEN the catalogue every action is filed under', () => {
  describe('WHEN the filing is read', () => {
    it('THEN every action is under exactly one', () => {
      /*
       * A partition, not a set of presets.
       *
       * An action under two catalogues would be the same switch drawn twice,
       * and two switches for one fact is how somebody sets one and believes
       * they set both.
       */
      const filed = catalogues.flatMap((catalogue) => [...CATALOGUES[catalogue].actions]);

      expect([...filed].sort()).toEqual([...permittedActions].sort());
      expect(new Set(filed).size).toBe(filed.length);
    });

    it('THEN an action can name the catalogue it is under', () => {
      expect(catalogueOf('card.move')).toBe('catalog.board');
      expect(catalogueOf('project.archive')).toBe('catalog.project');
      expect(catalogueOf('user.manage')).toBe('catalog.install');
    });

    it('THEN there are catalogues to check, so a sweep that found none fails', () => {
      expect(catalogues.length).toBeGreaterThan(2);
    });
  });

  describe('WHEN a name arrives from outside', () => {
    it('THEN only a real action is one', () => {
      expect(isRuleSubject('card.move')).toBe(true);
      expect(isRuleSubject('card.master')).toBe(false);
      expect(isRuleSubject('card.destroy')).toBe(false);
      expect(isRuleSubject('')).toBe(false);
    });
  });

  describe('WHEN an action is described', () => {
    it('THEN every one of them has a finished sentence', () => {
      // A permission nobody can explain is a permission nobody gives out
      // correctly.
      expect(permittedActions.every((action) => describeRule(action).trim().endsWith('.'))).toBe(
        true,
      );
    });
  });
});
