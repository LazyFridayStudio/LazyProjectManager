import type {
  PermissionGroupTable,
  PermissionRuleTable,
  TeamPermissionGroupTable,
  UserPermissionGroupTable,
} from './permission-tables.js';
import type {
  CardLinkTable,
  CommentMentionTable,
  WorkLogTable,
  CommentTable,
  SubtaskTable,
} from './activity-tables.js';
import type {
  AssetCategoryTable,
  AssetFileTable,
  AssetReferenceTable,
  AssetSequenceTable,
  AssetTable,
  AssetSubtaskTable,
  AssetTagTable,
  CardAssetLinkTable,
} from './asset-tables.js';
import type { BoardTable, CardTable, ListTable } from './board-tables.js';
import type { CardAttachmentTable, FileTable } from './file-tables.js';
import type {
  AccountTable,
  ApiTokenTable,
  AppUserTable,
  InstallSettingsTable,
  MembershipTable,
  SessionTable,
  TeamMemberTable,
  TeamTable,
} from './identity-tables.js';
import type { ProjectDocTable } from './doc-tables.js';
import type { MilestoneTable } from './milestone-tables.js';
import type { ProjectReleaseTable, ReleaseAssetTable } from './release-tables.js';
import type {
  CardSequenceTable,
  ProjectMemberTable,
  ProjectTable,
  ProjectTeamTable,
} from './project-tables.js';
import type {
  DismissedIssueTable,
  ScmConnectionTable,
  ScmEventRawTable,
  ScmLinkTable,
} from './scm-tables.js';
import type { CommandLogTable, DeletedThingTable, DomainEventTable } from './system-tables.js';

/**
 * The complete database shape Kysely is generic over.
 *
 * Every new table is added here and nowhere else; `Kysely<DatabaseSchema>` then
 * makes an unknown table or column a compile error rather than a runtime one.
 */
export interface DatabaseSchema {
  account: AccountTable;
  appUser: AppUserTable;
  apiToken: ApiTokenTable;
  membership: MembershipTable;
  team: TeamTable;
  teamMember: TeamMemberTable;
  permissionGroup: PermissionGroupTable;
  permissionRule: PermissionRuleTable;
  teamPermissionGroup: TeamPermissionGroupTable;
  userPermissionGroup: UserPermissionGroupTable;
  session: SessionTable;
  installSettings: InstallSettingsTable;
  project: ProjectTable;
  projectMember: ProjectMemberTable;
  projectTeam: ProjectTeamTable;
  cardSequence: CardSequenceTable;
  milestone: MilestoneTable;
  projectDoc: ProjectDocTable;
  projectRelease: ProjectReleaseTable;
  releaseAsset: ReleaseAssetTable;
  board: BoardTable;
  list: ListTable;
  card: CardTable;
  file: FileTable;
  cardAttachment: CardAttachmentTable;
  subtask: SubtaskTable;
  comment: CommentTable;
  commentMention: CommentMentionTable;
  workLog: WorkLogTable;
  cardLink: CardLinkTable;
  scmConnection: ScmConnectionTable;
  scmEventRaw: ScmEventRawTable;
  scmLink: ScmLinkTable;
  dismissedIssue: DismissedIssueTable;
  assetCategory: AssetCategoryTable;
  asset: AssetTable;
  assetReference: AssetReferenceTable;
  assetFile: AssetFileTable;
  assetSubtask: AssetSubtaskTable;
  assetTag: AssetTagTable;
  assetSequence: AssetSequenceTable;
  cardAssetLink: CardAssetLinkTable;
  commandLog: CommandLogTable;
  domainEvent: DomainEventTable;
  deletedThing: DeletedThingTable;
}
