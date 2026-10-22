import { Skin } from '../interfaces/skin.interface';

/**
 * Available skins. Each non-default skin has a matching stylesheet scoped to
 * `html[data-skin='<id>']` in `src/styles/skins/`. Add new skins here.
 */
export const DEFAULT_SKIN_ID = 'classic';

export const skins: Skin[] = [
  { id: DEFAULT_SKIN_ID, name: 'Classic', description: 'Smooth, rounded interface' },
  { id: 'pixel', name: 'Pixel', description: 'Blocky pixel-art interface' },
  { id: 'starcraft', name: 'StarCraft', description: 'Sci-fi command console with cut corners and glowing edges' },
  { id: 'warcraft', name: 'Warcraft', description: 'High-fantasy war table with gilded frames and carved stone' },
  { id: 'liquid', name: 'Liquid', description: 'Apple-style liquid glass with frosted surfaces and pill buttons' },
  { id: 'windows-xp', name: 'Windows XP', description: 'Luna-style desktop with glossy buttons and title bars' },
  { id: 'msdos', name: 'MS-DOS', description: 'Text-mode terminal with double-line frames and bracketed buttons' },
  { id: 'typewriter', name: 'Typewriter', description: 'Manuscript pages with typed labels and rubber stamps' },
  { id: 'notebook', name: 'Notebook', description: 'Hand-drawn sketchbook with ruled pages and tape' },
  { id: 'manuscript', name: 'Manuscript', description: 'Illuminated codex with blackletter titles and gilded frames' },
  { id: 'blueprint', name: 'Blueprint', description: 'Technical drawing sheet with grids and registration ticks' },
  { id: 'windows-95', name: 'Windows 95', description: 'Classic bevelled 3D chrome with title bars' },
  { id: 'mac-classic', name: 'Mac OS Classic', description: 'System 7 desktop with pinstriped title bars' },
  { id: 'crt', name: 'CRT Terminal', description: 'Glowing phosphor monitor with scanlines' },
  { id: 'jrpg', name: 'JRPG', description: '16-bit RPG menu windows with a pointer cursor' },
  { id: 'cyberpunk', name: 'Cyberpunk', description: 'Neon street HUD with slanted cuts and glitches' },
  { id: 'brutalist', name: 'Brutalist', description: 'Raw neo-brutalism with thick outlines and hard shadows' },
  { id: 'soft', name: 'Soft UI', description: 'Neumorphic surfaces that extrude and press in' },
  { id: 'art-deco', name: 'Art Deco', description: '1920s gilded geometry with sunbursts and keylines' },
  { id: 'comic', name: 'Comic', description: 'Inked comic panels with halftones and caption boxes' },
];

export function getSkinById(id: string): Skin | undefined {
  return skins.find(skin => skin.id === id);
}

export function getDefaultSkin(): Skin {
  return skins[0];
}
