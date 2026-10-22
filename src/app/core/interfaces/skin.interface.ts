/**
 * A skin changes the shape of the UI (corners, borders, depth, type, motion)
 * independently of the color theme. Skins are activated via `html[data-skin]`.
 */
export interface Skin {
  id: string;
  name: string;
  description?: string;
}
