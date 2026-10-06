export const LOCATION_TYPES = [
  { value: 'country', icon: 'flag', label: 'Country', description: 'A sovereign state or political realm.', examples: 'Kingdom, empire, republic, city-state.' },
  { value: 'region', icon: 'map', label: 'Region', description: 'A geographic area or subdivision of a country.', examples: 'Province, county, duchy, territory, borderlands.' },
  { value: 'settlement', icon: 'settlement', label: 'Settlement', description: 'A community where people live.', examples: 'City, town, village, hamlet, outpost.' },
  { value: 'district', icon: 'district', label: 'District', description: 'A distinct area within a settlement.', examples: 'Neighborhood, old town, market quarter, docks.' },
  { value: 'building', icon: 'building', label: 'Building', description: 'An individual structure or built site.', examples: 'Castle, palace, temple, tavern, ruins.' },
  { value: 'natural-feature', icon: 'mountain', label: 'Natural Feature', description: 'A naturally occurring landscape or body of water.', examples: 'Forest, mountain, river, lake, cave, island.' },
  { value: 'continent', icon: 'globe', label: 'Continent', description: 'A major landmass containing countries and regions.', examples: 'A northern continent, a divided supercontinent.' },
  { value: 'plane', icon: 'orbit', label: 'Plane', description: 'A world, dimension, or separate realm of existence.', examples: 'Material world, spirit realm, alternate dimension.' },
  { value: 'other', icon: 'map-pin', label: 'Other', description: 'A place that does not fit the other types.', examples: 'Traveling camp, magical crossroads, moving fortress.' },
] as const;

export type LocationType = (typeof LOCATION_TYPES)[number]['value'];

export function isLocationType(value: unknown): value is LocationType {
  return LOCATION_TYPES.some((type) => type.value === value);
}

export function getLocationTypeLabel(value: LocationType | undefined): string {
  return LOCATION_TYPES.find((type) => type.value === value)?.label || 'Unspecified';
}

/** Shared placeholder for the list and the editor; untyped places retain the map. */
export function getLocationPlaceholderIcon(value: LocationType | undefined): string {
  const icon = LOCATION_TYPES.find((type) => type.value === value)?.icon || 'map';
  return `assets/ui-icons.svg#${icon}`;
}

export interface Location {
  /** Stable identity stored in frontmatter; survives rename/move. */
  id: string;
  name: string;
  type?: LocationType;
  books: string[];
  /** Opaque wiki-link / path string for a single thumbnail. */
  thumbnail?: string;
  content: string;
  created: Date;
  modified: Date;
  /** Path relative to the project's locations/ folder. */
  relativePath: string;
  filePath: string;
}

export interface LocationFormData {
  name: string;
  type?: LocationType;
  books: string[];
  thumbnail?: string;
  content: string;
}

export interface LocationFrontmatter {
  /** Stable location identity; assigned on first load when missing. */
  id?: string;
  name: string;
  type?: LocationType;
  books: string[];
  thumbnail?: string;
  created?: string;
  modified?: string;
}
