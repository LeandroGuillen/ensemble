/**
 * Shared trash undo window. Single source of truth: `trash-constants.json`
 * at the project root (also required by `lib/trash-manager.js`).
 */
import trashConstants from '../../../../trash-constants.json';

export const UNDO_WINDOW_MS: number = trashConstants.UNDO_WINDOW_MS;
