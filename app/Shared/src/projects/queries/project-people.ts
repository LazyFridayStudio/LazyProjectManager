import { z } from 'zod';

import { defineQuery } from '../../envelope/query-definition.js';

/** How many the mention picker offers before it asks for a better search. */
export const PROJECT_PEOPLE_SHOWN = 6;

/**
 * The most this will list at once, for a caller that wants the whole project.
 *
 * A card's assignee is chosen from a list rather than searched for, so that
 * caller asks for everybody. Two hundred is far past the size of a project's
 * crew and still a bounded statement — and `more` says when it was not enough,
 * so a list that has been cut short can say so rather than quietly lie.
 */
export const PROJECT_PEOPLE_LISTED = 200;

/**
 * Which of the two questions this is asking.
 *
 * `crew` is the people who work on the project: named on it, or in a team that
 * is. `reaches` is those plus anybody whose role opens every project in the
 * install without being put on any of them.
 *
 * They are different lists and they are wanted in different places. A card is
 * given to the crew — a dropdown offering every lead in the studio for a project
 * none of them touch is noise, and work assigned to somebody who is not on the
 * job is work nobody picks up. A remark can name anybody who can open the card,
 * because asking the studio head a question about it is a reasonable thing to
 * do and they can read the answer.
 */
export const PROJECT_PEOPLE_ASKED = ['crew', 'reaches'] as const;

export type ProjectPeopleAsked = (typeof PROJECT_PEOPLE_ASKED)[number];

export const projectPersonSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  initials: z.string(),
  avatarUrl: z.string().nullable(),
});

export type ProjectPerson = z.infer<typeof projectPersonSchema>;

export const projectPeopleViewSchema = z.object({
  people: z.array(projectPersonSchema),
  /** Matched but not listed, so the picker can say to keep typing. */
  more: z.number().int().nonnegative(),
});

export type ProjectPeopleView = z.infer<typeof projectPeopleViewSchema>;

/**
 * The people on this project, asked one of the two ways `who` describes.
 *
 * Not `projects.detail`, which lists the people named on the project and
 * nobody else: somebody in a team that is on it never appears there, and they
 * work on the project like anyone else. This reads the same rules `reachedLevel`
 * reads, the other way round — that one answers "which projects does this person
 * get to", and this answers "who gets to this one".
 *
 * It is also the boundary on both things that name somebody. A mention of
 * anybody outside `reaches` is refused, because being told about a card you
 * cannot open is a notification that leads to a page saying the thing does not
 * exist. A card given to anybody outside `crew` is refused, because work handed
 * to somebody who is not on the job is work nobody picks up. Both refusals hold
 * whether or not a picker was what named them.
 */
export const projectPeopleQuery = defineQuery(
  'projects.people',
  z.object({
    projectId: z.string().uuid(),
    /** Matches a name. Absent lists the first few, which is a small project. */
    search: z.string().trim().max(120).optional(),
    /**
     * How many to list. Defaults to what a picker wants, not what a list does.
     *
     * The picker offers a handful and asks for a better search; a dropdown
     * choosing an assignee wants all of them. One question, two appetites.
     */
    limit: z.coerce.number().int().min(1).max(PROJECT_PEOPLE_LISTED).optional(),
    /** Which list. Defaults to everybody who can open the cards. */
    who: z.enum(PROJECT_PEOPLE_ASKED).optional(),
  }),
  projectPeopleViewSchema,
);
