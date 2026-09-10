import { z } from 'zod';

import { defineQuery } from '../../envelope/query-definition.js';

/** How many entries one request returns. */
export const AUDIT_PAGE_SIZE = 50;

/**
 * The kinds of thing an entry can be about.
 *
 * Also the filter across the top of the trail, which is why it is its own
 * constant: a chip row built from a second list would be one word out of step
 * with what the entries actually say.
 */
export const AUDIT_SUBJECT_KINDS = ['card', 'project', 'board', 'install', 'user', 'team'] as const;

export type AuditSubjectKind = (typeof AUDIT_SUBJECT_KINDS)[number];

/**
 * What an entry happened to.
 *
 * The id is not shown — an audit trail full of uuids is a trail nobody reads —
 * but it is carried so the screen can offer to open the thing, and so an entry
 * whose subject has since been deleted still says what kind of thing it was.
 */
export const auditSubjectSchema = z.object({
  kind: z.enum(AUDIT_SUBJECT_KINDS),
  id: z.string(),
  /** The card key, the project name, or nothing when it no longer exists. */
  label: z.string().nullable(),
});

export const auditEntrySchema = z.object({
  id: z.string(),
  /** The event name as recorded. The screen puts it into words. */
  name: z.string(),
  occurredAt: z.string(),
  subject: auditSubjectSchema,
  /** Null for anything the server did to itself, which is not nobody. */
  actor: z
    .object({
      userId: z.string().uuid(),
      displayName: z.string(),
      initials: z.string(),
      /** Their picture, or null for somebody drawn as their initials. */
      avatarUrl: z.string().nullable(),
    })
    .nullable(),
});

export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditTrailViewSchema = z.object({
  entries: z.array(auditEntrySchema),
  /**
   * Pass back as `before` for the next page, or null at the end.
   *
   * A cursor rather than an offset: the trail grows at the head while somebody
   * is reading it, and an offset would show them the same entry twice.
   */
  nextCursor: z.string().nullable(),
});

export type AuditTrailView = z.infer<typeof auditTrailViewSchema>;

/**
 * What has happened on this install, newest first.
 *
 * Reads `domain_event`, which every command already appends to in the same
 * transaction as its write — so this is the audit trail the outbox was always
 * going to give us, rather than a second log that could disagree with the first.
 */
export const auditTrailQuery = defineQuery(
  'audit.trail',
  z.object({
    /** The id to read back from, exclusive. Absent means start at the newest. */
    before: z.string().optional(),
    projectId: z.string().uuid().optional(),
    /** One kind of thing, or absent for all of them. */
    kind: z.enum(AUDIT_SUBJECT_KINDS).optional(),
    /**
     * Matched against what it happened to, who did it, and the event's own
     * name.
     *
     * Three fields rather than one, because somebody looking for "who deleted
     * EXMP-BUG-4" has the key, and somebody looking for "what did Alex do"
     * has a name, and somebody looking for "what got deleted" has neither.
     */
    search: z.string().trim().max(120).optional(),
  }),
  auditTrailViewSchema,
);
