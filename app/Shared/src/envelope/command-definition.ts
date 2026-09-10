import { z } from 'zod';

import { failureSchema } from './failure.js';

/**
 * Every command carries a client-generated id so a retried request is a no-op
 * rather than a duplicate write. `command_log` has a unique index on it.
 */
export const commandEnvelopeSchema = z.object({
  commandId: z.string().uuid(),
});

export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;

/**
 * A command returns identifiers and nothing else — never a view model. The
 * client refetches the query it cares about after the WebSocket invalidation
 * frame arrives, which keeps one read path instead of two.
 */
export const commandSuccessSchema = z.object({
  ok: z.literal(true),
  id: z.string().uuid().optional(),
  /**
   * Where the client must send the bytes to finish what the command started.
   *
   * `/api/f/<id>` on this install. It was a presigned URL at the object store
   * until #172, when that turned out to be an address a released install does
   * not publish — the field stayed because an upload still needs somewhere to
   * go and an id alone does not say where.
   */
  uploadUrl: z.string().optional(),
  /**
   * A secret the command just made, returned once and never again.
   *
   * The second exception to "commands return identifiers", and the narrower
   * one: an API key exists in readable form for exactly the length of this
   * reply. Only its hash is stored, so there is no query that could hand it
   * back and no retry that returns it a second time.
   *
   * Nothing else should use this. A value that can be fetched again belongs
   * behind a query, where a permission can be asked about it every time.
   */
  secret: z.string().optional(),
});

export type CommandSuccess = z.infer<typeof commandSuccessSchema>;

export const commandResultSchema = z.union([commandSuccessSchema, failureSchema]);

export type CommandResult = z.infer<typeof commandResultSchema>;

/**
 * The wire description of one command, imported by both the API route and the
 * web client so the two cannot disagree about a name or an input shape.
 */
export interface CommandDefinition<
  TName extends string = string,
  TInputSchema extends z.ZodTypeAny = z.ZodTypeAny,
> {
  readonly name: TName;
  readonly inputSchema: TInputSchema;
}

export type CommandInput<TDefinition extends CommandDefinition> = z.infer<
  TDefinition['inputSchema']
> &
  CommandEnvelope;

/**
 * Declares a command.
 *
 * The name is the URL segment: `defineCommand('board.moveCard', …)` is served at
 * `POST /api/c/board.moveCard`. Group commands by module and use a verb, so the
 * name reads as the action it performs.
 */
export function defineCommand<TName extends string, TInputSchema extends z.ZodTypeAny>(
  name: TName,
  inputSchema: TInputSchema,
): CommandDefinition<TName, TInputSchema> {
  return { name, inputSchema };
}

/** The full request body a command accepts: its own input plus the envelope. */
export function getCommandRequestSchema(definition: CommandDefinition): z.ZodTypeAny {
  return commandEnvelopeSchema.and(definition.inputSchema);
}

export function createCommandSuccess(id?: string): CommandSuccess {
  return id === undefined ? { ok: true } : { ok: true, id };
}

/** A command that hands back a secret nothing can ever read again. */
export function createSecretSuccess(id: string, secret: string): CommandSuccess {
  return { ok: true, id, secret };
}

/** A command that hands back somewhere to upload to, as well as the file's id. */
export function createUploadSuccess(id: string, uploadUrl: string): CommandSuccess {
  return { ok: true, id, uploadUrl };
}
