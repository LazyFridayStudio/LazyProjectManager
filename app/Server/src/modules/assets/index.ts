export { createAssetCategoryHandler, createAssetHandler } from './commands/create-asset.js';

export { linkAssetHandler, unlinkAssetHandler } from './commands/link-asset.js';

export {
  moveAssetReferenceHandler,
  promoteAssetReferenceHandler,
  removeAssetReferenceHandler,
} from './commands/asset-references.js';

export { linkAssetFileHandler, removeAssetFileHandler } from './commands/asset-files.js';

export { tagAssetHandler, untagAssetHandler } from './commands/asset-tags.js';

export {
  addAssetSubtaskHandler,
  removeAssetSubtaskHandler,
  updateAssetSubtaskHandler,
} from './commands/asset-subtasks.js';

export { deleteAssetCategoryHandler } from './commands/delete-category.js';

export { deleteAssetHandler } from './commands/delete-asset.js';

export { updateAssetCategoryHandler } from './commands/update-category.js';

export { updateAssetHandler } from './commands/update-asset.js';

export { moveAssetHandler } from './commands/move-asset.js';

export { moveAssetCategoryHandler } from './commands/move-category.js';

export { assetDetailHandler } from './queries/asset-detail.js';

export { assetLibraryHandler } from './queries/asset-library.js';
