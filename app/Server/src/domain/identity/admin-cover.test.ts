import { describe, expect, it } from 'vitest';

import { InvariantViolatedError } from '../errors/domain-error.js';
import { assertAnAdminRemains } from './admin-cover.js';

describe('GIVEN an install with one admin who can still sign in', () => {
  describe('WHEN that admin is the one being changed', () => {
    it('THEN it is refused, because nobody would be left to change it back', () => {
      expect(() => {
        assertAnAdminRemains({ activeAdminCount: 1, subjectIsActiveAdmin: true });
      }).toThrow(InvariantViolatedError);
    });

    it('THEN the message says what to do first', () => {
      expect(() => {
        assertAnAdminRemains({ activeAdminCount: 1, subjectIsActiveAdmin: true });
      }).toThrow('Make somebody else an admin first.');
    });
  });

  describe('WHEN somebody who is not that admin is being changed', () => {
    it('THEN it goes ahead', () => {
      expect(() => {
        assertAnAdminRemains({ activeAdminCount: 1, subjectIsActiveAdmin: false });
      }).not.toThrow();
    });
  });
});

describe('GIVEN an install with two admins who can sign in', () => {
  describe('WHEN one of them is being changed', () => {
    it('THEN it goes ahead, because the other one is still there', () => {
      expect(() => {
        assertAnAdminRemains({ activeAdminCount: 2, subjectIsActiveAdmin: true });
      }).not.toThrow();
    });
  });
});

describe('GIVEN an install whose only admin is already suspended', () => {
  describe('WHEN they are changed again', () => {
    it('THEN it goes ahead: a suspended admin is not cover, so there is none to lose', () => {
      expect(() => {
        assertAnAdminRemains({ activeAdminCount: 0, subjectIsActiveAdmin: false });
      }).not.toThrow();
    });
  });
});
