import { describe, expect, it } from 'vitest';

import { getCommandRequestSchema } from '../envelope/command-definition.js';
import { createProjectCommand } from './commands/create-project.js';
import { updateProjectCommand } from './commands/update-project.js';
import {
  budgetMinorSchema,
  calendarDateSchema,
  describeProjectPhase,
  describeSyncEvery,
  formatCardKey,
  projectCodeSchema,
  projectSlugSchema,
  syncEverySecondsSchema,
  FASTEST_SYNC_SECONDS,
  PROJECT_PHASES,
  SYNC_EVERY_CHOICES,
} from './project-vocabulary.js';
import { projectListQuery } from './queries/project-list.js';

const COMMAND_ID = '018f0000-0000-7000-8000-000000000001';

describe('GIVEN the project code a person types into the create form', () => {
  describe('WHEN it is typed in lower case', () => {
    it('THEN it is accepted as the upper-case code it will be stored as', () => {
      expect(projectCodeSchema.parse('sltm')).toBe('SLTM');
      expect(projectCodeSchema.parse('  drch  ')).toBe('DRCH');
    });
  });

  describe('WHEN it is a shape a ticket key could not carry', () => {
    it('THEN it is refused', () => {
      const rejected = ['D', '1DRCH', 'DR-CH', 'DR CH', 'TOOLONGACODE', ''];

      for (const candidate of rejected) {
        expect(projectCodeSchema.safeParse(candidate).success).toBe(false);
      }
    });
  });
});

describe('GIVEN a project address arriving as a query parameter', () => {
  describe('WHEN it is a slug the server produces', () => {
    it('THEN it is accepted', () => {
      expect(projectSlugSchema.parse('harbour-night')).toBe('harbour-night');
    });
  });

  describe('WHEN it is something else', () => {
    it('THEN it is refused before it reaches a query', () => {
      const rejected = ['Harbour Night', '-harbour', 'harbour--night', 'harbour_night', ''];

      for (const candidate of rejected) {
        expect(projectSlugSchema.safeParse(candidate).success).toBe(false);
      }
    });
  });
});

describe('GIVEN a budget arriving from the create form', () => {
  describe('WHEN it is whole cents that are not negative', () => {
    it('THEN it is accepted', () => {
      expect(budgetMinorSchema.parse(0)).toBe(0);
      expect(budgetMinorSchema.parse(64_000_000)).toBe(64_000_000);
    });
  });

  describe('WHEN it is negative, fractional, or beyond any real budget', () => {
    it('THEN it is refused', () => {
      expect(budgetMinorSchema.safeParse(-1).success).toBe(false);
      expect(budgetMinorSchema.safeParse(10.5).success).toBe(false);
      expect(budgetMinorSchema.safeParse(1_000_000_000_001).success).toBe(false);
    });
  });
});

describe('GIVEN a calendar date on the wire', () => {
  describe('WHEN it is written the way Postgres returns one', () => {
    it('THEN it is accepted', () => {
      expect(calendarDateSchema.parse('2026-08-18')).toBe('2026-08-18');
    });
  });

  describe('WHEN it carries a time or a zone', () => {
    it('THEN it is refused, because a ship date is a day and not an instant', () => {
      expect(calendarDateSchema.safeParse('2026-08-18T00:00:00Z').success).toBe(false);
      expect(calendarDateSchema.safeParse('18/08/2026').success).toBe(false);
    });
  });
});

describe('GIVEN the projects.create request body', () => {
  describe('WHEN only the fields the form insists on are sent', () => {
    it('THEN the rest take their defaults, so a project needs a name and a code', () => {
      const parsed: unknown = getCommandRequestSchema(createProjectCommand).parse({
        commandId: COMMAND_ID,
        name: 'Saltmarsh',
        code: 'SLTM',
      });

      expect(parsed).toMatchObject({ name: 'Saltmarsh', code: 'SLTM', phase: 'prototype' });
    });
  });

  describe('WHEN the name is blank', () => {
    it('THEN it is refused', () => {
      const result = getCommandRequestSchema(createProjectCommand).safeParse({
        commandId: COMMAND_ID,
        name: '   ',
        code: 'SLTM',
      });

      expect(result.success).toBe(false);
    });
  });
});

describe('GIVEN the projects.update request body', () => {
  describe('WHEN a field is left out', () => {
    it('THEN it is absent rather than null, which is what keeps its value', () => {
      const parsed = updateProjectCommand.inputSchema.parse({
        projectId: '018f0000-0000-7000-8000-0000000000aa',
        phase: 'alpha',
      });

      expect(parsed).toEqual({
        projectId: '018f0000-0000-7000-8000-0000000000aa',
        phase: 'alpha',
      });
    });
  });

  describe('WHEN a field is sent as null', () => {
    it('THEN it survives parsing, because null is how a field is cleared', () => {
      const parsed = updateProjectCommand.inputSchema.parse({
        projectId: '018f0000-0000-7000-8000-0000000000aa',
        shipsOn: null,
      });

      expect(parsed).toMatchObject({ shipsOn: null });
    });
  });

  describe('WHEN it tries to change the code', () => {
    it('THEN the code is not part of the command at all', () => {
      // Ticket keys already issued carry the code, so there is no field to send.
      expect(Object.keys(updateProjectCommand.inputSchema.shape)).not.toContain('code');
    });
  });
});

describe('GIVEN the projects.list parameters', () => {
  describe('WHEN no scope is asked for', () => {
    it('THEN the launcher gets live projects', () => {
      expect(projectListQuery.paramsSchema.parse({})).toEqual({ scope: 'live' });
    });
  });

  describe('WHEN an unknown scope is asked for', () => {
    it('THEN it is refused rather than silently treated as live', () => {
      expect(projectListQuery.paramsSchema.safeParse({ scope: 'everything' }).success).toBe(false);
    });
  });
});

describe('GIVEN a phase being written on screen', () => {
  describe('WHEN it is any phase a project can be in', () => {
    it('THEN it has a label, so no screen ever renders the stored value', () => {
      for (const phase of PROJECT_PHASES) {
        const label = describeProjectPhase(phase);

        expect(label).not.toBe('');
        expect(label).not.toContain('_');
      }
    });
  });
});

describe('GIVEN a card key being formatted', () => {
  describe('WHEN a project issues its next number', () => {
    it('THEN the key reads as the project, the type and the number', () => {
      expect(formatCardKey('DRCH', 'ART', 208)).toBe('DRCH-ART-208');
      expect(formatCardKey('KILN', 'BUILD', 1)).toBe('KILN-BUILD-1');
    });
  });
});

describe('GIVEN how often a repository should be synced', () => {
  describe('WHEN a choice is offered on the settings screen', () => {
    it('THEN it has a name a person would recognise, and no bare number', () => {
      for (const seconds of SYNC_EVERY_CHOICES) {
        const label = describeSyncEvery(seconds);

        expect(label).not.toBe('');
        expect(label).not.toBe(String(seconds));
      }
    });

    it('THEN every choice is one the database would accept', () => {
      for (const seconds of SYNC_EVERY_CHOICES) {
        expect(syncEverySecondsSchema.safeParse(seconds).success).toBe(true);
      }
    });
  });

  describe('WHEN the clock is off', () => {
    it('THEN it says what is still working, rather than reading as disconnected', () => {
      const label = describeSyncEvery(null);

      expect(label).toContain('Off');
      expect(label).toContain('press');
    });
  });

  describe('WHEN something asks for a repository to be read faster than the floor', () => {
    it("THEN it is refused, because the cost is somebody else's rate limit", () => {
      expect(syncEverySecondsSchema.safeParse(FASTEST_SYNC_SECONDS - 1).success).toBe(false);
      expect(syncEverySecondsSchema.safeParse(0).success).toBe(false);
      expect(syncEverySecondsSchema.safeParse(90.5).success).toBe(false);
    });
  });
});
