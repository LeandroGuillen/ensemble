import { Theme } from '../interfaces/theme.interface';

/**
 * Gruvbox theme - Retro groove with earthy, high-contrast warmth
 * Based on the popular Gruvbox (dark, hard contrast) palette
 */
export const gruvboxTheme: Theme = {
  id: 'gruvbox',
  name: 'Gruvbox',
  description: 'Retro earthy tones with orange accents',
  colors: {
    // Background colors - bg0_h through bg2
    bgPrimary: '#1d2021',
    bgSecondary: '#282828',
    bgTertiary: '#32302f',
    bgElevated: '#3c3836',
    bgHover: '#504945',

    // Accent colors - Gruvbox orange
    accentPrimary: '#fe8019',
    accentSecondary: '#ffa25a',
    accentDark: '#d65d0e',
    accentMuted: '#8f4a14',
    accentSubtle: 'rgba(254, 128, 25, 0.12)',

    // Text colors - Warm parchment
    textPrimary: '#ebdbb2',
    textSecondary: '#d5c4a1',
    textMuted: '#928374',
    textInverse: '#1d2021',

    // Border colors
    border: '#3c3836',
    borderLight: '#504945',
    borderSubtle: '#32302f',

    // Status colors
    success: '#b8bb26',
    warning: '#fabd2f',
    error: '#fb4934',
    info: '#83a598',

    // Shadows
    shadowSm: '0 1px 3px rgba(0, 0, 0, 0.35)',
    shadowMd: '0 4px 12px rgba(0, 0, 0, 0.4)',
    shadowLg: '0 8px 24px rgba(0, 0, 0, 0.45)',
    shadowXl: '0 16px 48px rgba(0, 0, 0, 0.5)',
    shadowGlow: '0 0 24px rgba(254, 128, 25, 0.25)',
    shadowCard: '0 2px 8px rgba(0, 0, 0, 0.3), 0 0 1px rgba(0, 0, 0, 0.35)',
  },
  colorPalette: [
    '#83a598', // Blue
    '#b8bb26', // Green
    '#fb4934', // Red
    '#d3869b', // Purple
    '#fe8019', // Orange
    '#8ec07c', // Aqua
    '#b16286', // Faded Purple
    '#d65d0e', // Burnt Orange
    '#fabd2f', // Yellow
    '#7c6f64'  // Warm Grey
  ],
};
