/**
 * What each recorded event is called in plain words.
 *
 * The audit trail reads `domain_event`, whose names are written for code —
 * `board.cardMoved` is exactly right in a switch and wrong on a screen somebody
 * is scanning for what happened last Tuesday.
 *
 * A closed map with a fallback rather than a rule that rewrites the name: a rule
 * would turn a new event into something almost-English and nobody would notice
 * it needed a phrase, whereas an unmapped name shows as itself and asks to be
 * added here.
 */
const PHRASE_BY_EVENT: Readonly<Record<string, string>> = {
  'identity.installCompleted': 'Set this server up',
  'identity.userSignedIn': 'Signed in',
  'identity.userCreated': 'Added a person',
  'identity.userRoleChanged': 'Changed what a person may do',
  'identity.userSuspended': 'Suspended a person',
  'identity.userRestored': 'Let a person back in',
  'identity.agentCreated': 'Made an agent',
  'identity.agentUpdated': 'Changed an agent',
  'identity.agentTokenIssued': 'Gave an agent a key',
  'identity.agentTokenRevoked': 'Stopped an agent key',
  'identity.passwordReset': "Reset somebody's password",
  'identity.passwordChanged': 'Changed their own password',
  'identity.profileChanged': 'Changed their own name',
  'identity.avatarChanged': 'Changed their own picture',
  'teams.created': 'Made a team',
  'teams.updated': 'Changed a team',
  'teams.deleted': 'Removed a team',
  'teams.memberAdded': 'Put somebody in a team',
  'teams.memberRemoved': 'Took somebody out of a team',
  'teams.defaultChanged': 'Changed what a team reaches by default',
  'teams.grantChanged': 'Changed what a team can reach',
  'teams.grantRemoved': 'Took a grant off a team',
  'projects.projectCreated': 'Created the project',
  'projects.projectUpdated': 'Changed the project',
  'projects.memberAdded': 'Put somebody on the project',
  'projects.memberRemoved': 'Took somebody off the project',
  'projects.teamAdded': 'Put a team on the project',
  'projects.teamRemoved': 'Took a team off the project',
  'projects.projectArchived': 'Archived the project',
  'projects.projectRestored': 'Restored the project',
  'board.cardCreated': 'Created a card',
  'board.cardUpdated': 'Changed a card',
  'board.cardDeleted': 'Deleted a card',
  'board.cardMoved': 'Moved a card',
  'board.cardLinked': 'Linked two cards',
  'board.cardUnlinked': 'Unlinked two cards',
  'permissions.groupCreated': 'Made a permission group',
  'permissions.groupRenamed': 'Renamed a permission group',
  'permissions.groupDeleted': 'Deleted a permission group',
  'permissions.ruleSet': 'Changed what a permission group allows',
  'permissions.teamGroupSet': "Changed a team's permission groups",
  'permissions.userGroupSet': "Changed somebody's permission groups",
  'permissions.teamGroupsOrdered': "Reordered a team's permission groups",
  'board.legendSet': 'Made a card a legend',
  'board.legendCleared': 'Stopped a card being a legend',
  'board.cardGathered': 'Put a card under a legend',
  'board.cardReleased': 'Took a card out of a legend',
  'board.commented': 'Commented',
  'board.subtaskAdded': 'Added a sub-task',
  'board.subtaskUpdated': 'Ticked a sub-task off',
  'board.subtaskRemoved': 'Removed a sub-task',
  'assets.moved': 'Moved an asset',
  'assets.categoryMoved': 'Moved a category',
  // A stage of an asset rather than a step of a card, and the trail says which:
  // both are checklists, and "Added a sub-task" twice over would leave somebody
  // opening two things to find out which one moved.
  'assets.subtaskAdded': 'Added a stage to an asset',
  'assets.subtaskUpdated': 'Ticked a stage of an asset off',
  'assets.subtaskRemoved': 'Removed a stage from an asset',
  'board.listCreated': 'Added a list',
  'board.listUpdated': 'Changed a list',
  'board.listMoved': 'Moved a list',
  'board.listArchived': 'Removed a list',
  'files.uploaded': 'Attached a file',
  'files.detached': 'Removed a file',
  'scm.connected': 'Connected a repository',
  'scm.disconnected': 'Disconnected the repository',
  'scm.linked': 'Matched a commit to a card',
  'board.cardsSynced': "Read the repository's issues in",
  'recovery.restored': 'Put a deleted thing back',
  'recovery.purged': 'Threw a deleted thing away for good',
};

export function describeDomainEvent(name: string): string {
  return PHRASE_BY_EVENT[name] ?? name;
}

/** Whether anybody has written words for this event yet. */
export function hasDomainEventPhrase(name: string): boolean {
  return name in PHRASE_BY_EVENT;
}

/** Every event the trail knows how to say out loud. */
export function describedDomainEvents(): readonly string[] {
  return Object.keys(PHRASE_BY_EVENT);
}
