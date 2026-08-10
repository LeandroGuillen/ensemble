/**
 * Disk shapes accepted only by loaders/migrators.
 * Modern runtime types omit these fields; strip or map them on load.
 */

/** Pre-lastSession root field on ensemble.json; migrated to lastSession.lastPinboardId. */
export interface LegacyProjectMetadataFields {
  currentPinboardId?: string;
}

/** Pre-arrowFrom/arrowTo edge field; used when loading older pinboard edges. */
export interface LegacyPinboardConnectionFields {
  /** true = both arrows; false = arrow to target only */
  bidirectional?: boolean;
}
