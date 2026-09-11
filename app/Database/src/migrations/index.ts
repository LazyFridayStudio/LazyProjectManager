import type { Migration, MigrationProvider } from 'kysely/migration';

import * as initialSchema from './0001-initial-schema.js';
import * as projects from './0002-projects.js';
import * as board from './0003-board.js';
import * as wipAdvisory from './0004-wip-advisory.js';
import * as cardActivity from './0005-card-activity.js';
import * as files from './0006-files.js';
import * as thumbnails from './0007-thumbnails.js';
import * as scm from './0008-scm.js';
import * as scmLinks from './0009-scm-links.js';
import * as assets from './0010-assets.js';
import * as cardAssetLinks from './0011-card-asset-links.js';
import * as assetKeyArt from './0012-asset-key-art.js';
import * as assetReferences from './0013-asset-references.js';
import * as assetFiles from './0014-asset-files.js';
import * as assetTags from './0015-asset-tags.js';
import * as assetKeys from './0016-asset-keys.js';
import * as scmAppAccess from './0017-scm-app-access.js';
import * as memberCapacity from './0018-member-capacity.js';
import * as designDoc from './0019-design-doc.js';
import * as milestones from './0020-milestones.js';
import * as oneDesignDocument from './0021-one-design-document.js';
import * as manyDesignDocuments from './0022-many-design-documents.js';
import * as whoWroteItLast from './0023-who-wrote-it-last.js';
import * as releases from './0024-releases.js';
import * as syncedReleases from './0025-synced-releases.js';
import * as buildRuns from './0026-build-runs.js';
import * as noLfsLinks from './0027-no-lfs-links.js';
import * as issueCards from './0028-issue-cards.js';
import * as teams from './0029-teams.js';
import * as teamAccess from './0030-team-access.js';
import * as noBuildRuns from './0031-no-build-runs.js';
import * as legendCards from './0032-legend-cards.js';
import * as permissionGroups from './0033-permission-groups.js';
import * as rulesNameOneAction from './0034-rules-name-one-action.js';
import * as noTeamGrants from './0035-no-team-grants.js';
import * as aWeekToChangeYourMind from './0036-a-week-to-change-your-mind.js';
import * as theInstallOwner from './0037-the-install-owner.js';
import * as aDeletedCardStaysDeleted from './0038-a-deleted-card-stays-deleted.js';
import * as noPortfolios from './0039-no-portfolios.js';
import * as peopleHoldGroups from './0040-people-hold-groups.js';
import * as permissionsInAnOrder from './0041-permissions-in-an-order.js';
import * as everybodyHasAWholeDay from './0042-everybody-has-a-whole-day.js';
import * as aProjectHasALogo from './0043-a-project-has-a-logo.js';
import * as aTeamCanBeOnAProject from './0044-a-team-can-be-on-a-project.js';
import * as aPersonHasAPicture from './0045-a-person-has-a-picture.js';
import * as somebodyWasNamed from './0046-somebody-was-named.js';
import * as workThatWasDone from './0047-work-that-was-done.js';
import * as aThemeOfYourOwn from './0048-a-theme-of-your-own.js';
import * as anAgentIsSomebody from './0049-an-agent-is-somebody.js';
import * as anAssetWasAskedFor from './0050-an-asset-was-asked-for.js';
import * as anAssetIsMadeInStages from './0051-an-asset-is-made-in-stages.js';
import * as aDownloadSaysWhereItIs from './0052-a-download-says-where-it-is.js';
import * as theLastListMeansClosed from './0053-the-last-list-means-closed.js';
import * as sectionsAProjectDoesNotUse from './0054-sections-a-project-does-not-use.js';
import * as aDeliveryMakesTheSyncDue from './0055-a-delivery-makes-the-sync-due.js';
import * as syncOnlyTheOpenIssues from './0056-sync-only-the-open-issues.js';
import * as aThemeYouWriteYourself from './0057-a-theme-you-write-yourself.js';
import * as howOftenARepositorySyncs from './0058-how-often-a-repository-syncs.js';
import * as oneSyncAtATime from './0059-one-sync-at-a-time.js';
import * as aCategoryInsideACategory from './0060-a-category-inside-a-category.js';
import * as aNameCanWaitForTheEndOfACommand from './0061-a-name-can-wait-for-the-end-of-a-command.js';

/**
 * Migrations are registered here by hand rather than discovered from disk.
 *
 * A static import list survives bundling, works the same on Windows and in the
 * Linux container, and makes the order visible in one place. Keys are what
 * Kysely records in `kysely_migration`, so they are append-only: rename one and
 * an already-migrated database will try to run it again.
 */
const migrationsByName: Readonly<Record<string, Migration>> = {
  '0001-initial-schema': initialSchema,
  '0002-projects': projects,
  '0003-board': board,
  '0004-wip-advisory': wipAdvisory,
  '0005-card-activity': cardActivity,
  '0006-files': files,
  '0007-thumbnails': thumbnails,
  '0008-scm': scm,
  '0009-scm-links': scmLinks,
  '0010-assets': assets,
  '0011-card-asset-links': cardAssetLinks,
  '0012-asset-key-art': assetKeyArt,
  '0013-asset-references': assetReferences,
  '0014-asset-files': assetFiles,
  '0015-asset-tags': assetTags,
  '0016-asset-keys': assetKeys,
  '0017-scm-app-access': scmAppAccess,
  '0018-member-capacity': memberCapacity,
  '0019-design-doc': designDoc,
  '0020-milestones': milestones,
  '0021-one-design-document': oneDesignDocument,
  '0022-many-design-documents': manyDesignDocuments,
  '0023-who-wrote-it-last': whoWroteItLast,
  '0024-releases': releases,
  '0025-synced-releases': syncedReleases,
  '0026-build-runs': buildRuns,
  '0027-no-lfs-links': noLfsLinks,
  '0028-issue-cards': issueCards,
  '0029-teams': teams,
  '0030-team-access': teamAccess,
  '0031-no-build-runs': noBuildRuns,
  '0032-legend-cards': legendCards,
  '0033-permission-groups': permissionGroups,
  '0034-rules-name-one-action': rulesNameOneAction,
  '0035-no-team-grants': noTeamGrants,
  '0036-a-week-to-change-your-mind': aWeekToChangeYourMind,
  '0037-the-install-owner': theInstallOwner,
  '0038-a-deleted-card-stays-deleted': aDeletedCardStaysDeleted,
  '0039-no-portfolios': noPortfolios,
  '0040-people-hold-groups': peopleHoldGroups,
  '0041-permissions-in-an-order': permissionsInAnOrder,
  '0042-everybody-has-a-whole-day': everybodyHasAWholeDay,
  '0043-a-project-has-a-logo': aProjectHasALogo,
  '0044-a-team-can-be-on-a-project': aTeamCanBeOnAProject,
  '0045-a-person-has-a-picture': aPersonHasAPicture,
  '0046-somebody-was-named': somebodyWasNamed,
  '0047-work-that-was-done': workThatWasDone,
  '0048-a-theme-of-your-own': aThemeOfYourOwn,
  '0049-an-agent-is-somebody': anAgentIsSomebody,
  '0050-an-asset-was-asked-for': anAssetWasAskedFor,
  '0051-an-asset-is-made-in-stages': anAssetIsMadeInStages,
  '0052-a-download-says-where-it-is': aDownloadSaysWhereItIs,
  '0053-the-last-list-means-closed': theLastListMeansClosed,
  '0054-sections-a-project-does-not-use': sectionsAProjectDoesNotUse,
  '0055-a-delivery-makes-the-sync-due': aDeliveryMakesTheSyncDue,
  '0056-sync-only-the-open-issues': syncOnlyTheOpenIssues,
  '0057-a-theme-you-write-yourself': aThemeYouWriteYourself,
  '0058-how-often-a-repository-syncs': howOftenARepositorySyncs,
  '0059-one-sync-at-a-time': oneSyncAtATime,
  '0060-a-category-inside-a-category': aCategoryInsideACategory,
  '0061-a-name-can-wait-for-the-end-of-a-command': aNameCanWaitForTheEndOfACommand,
};

export const migrationProvider: MigrationProvider = {
  getMigrations(): Promise<Record<string, Migration>> {
    return Promise.resolve({ ...migrationsByName });
  },
};

export function getMigrationNames(): readonly string[] {
  return Object.keys(migrationsByName);
}
