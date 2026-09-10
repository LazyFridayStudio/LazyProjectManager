import { describe, expect, it } from 'vitest';

import { membershipRoleSchema } from './queries/me.js';
import { describeRole, summariseRole, ROLE_ORDER } from './role-vocabulary.js';

describe('GIVEN the roles somebody can hold on an install', () => {
  describe('WHEN they are offered as a choice', () => {
    it('THEN the most trusted comes first, so the list reads as a ladder', () => {
      expect(ROLE_ORDER[0]).toBe('owner');
      expect(ROLE_ORDER.at(-1)).toBe('viewer');
    });

    it('THEN every role the contract allows is offered, and nothing else', () => {
      expect([...ROLE_ORDER].sort()).toEqual([...membershipRoleSchema.options].sort());
    });
  });

  describe('WHEN one is drawn on screen', () => {
    it('THEN owner is called Admin, which is what the person holding it is called', () => {
      expect(describeRole('owner')).toBe('Admin');
    });

    it('THEN each one has a name of its own', () => {
      const names = ROLE_ORDER.map(describeRole);

      expect(new Set(names).size).toBe(ROLE_ORDER.length);
    });

    it('THEN each one says in a sentence what it may do', () => {
      for (const role of ROLE_ORDER) {
        expect(summariseRole(role).length).toBeGreaterThan(20);
      }
    });
  });
});
