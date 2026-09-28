import { Theme } from '../interfaces/theme.interface';

/**
 * Catppuccin Mocha theme - Soothing pastels on a warm dark base
 * Based on the popular Catppuccin (Mocha flavor) palette
 */
export const catppuccinMochaTheme: Theme = {
  id: 'catppuccin-mocha',
  name: 'Catppuccin Mocha',
  description: 'Soothing pastels with mauve accents',
  colors: {
    // Background colors - Crust, mantle, base, surfaces
    bgPrimary: '#11111b',
    bgSecondary: '#181825',
    bgTertiary: '#1e1e2e',
    bgElevated: '#313244',
    bgHover: '#45475a',

    // Accent colors - Mauve
    accentPrimary: '#cba6f7',
    accentSecondary: '#dcc2fa',
    accentDark: '#b28ae8',
    accentMuted: '#7c6a9e',
    accentSubtle: 'rgba(203, 166, 247, 0.12)',

    // Text colors - Text, subtext, overlay
    textPrimary: '#cdd6f4',
    textSecondary: '#a6adc8',
    textMuted: '#7f849c',
    textInverse: '#11111b',

    // Border colors
    border: '#313244',
    borderLight: '#45475a',
    borderSubtle: '#1e1e2e',

    // Status colors
    success: '#a6e3a1',
    warning: '#f9e2af',
    error: '#f38ba8',
    info: '#89b4fa',

    // Shadows
    shadowSm: '0 1px 3px rgba(0, 0, 0, 0.35)',
    shadowMd: '0 4px 12px rgba(0, 0, 0, 0.4)',
    shadowLg: '0 8px 24px rgba(0, 0, 0, 0.45)',
    shadowXl: '0 16px 48px rgba(0, 0, 0, 0.5)',
    shadowGlow: '0 0 24px rgba(203, 166, 247, 0.3)',
    shadowCard: '0 2px 8px rgba(0, 0, 0, 0.3), 0 0 1px rgba(0, 0, 0, 0.35)',
  },
  colorPalette: [
    '#89b4fa', // Blue
    '#a6e3a1', // Green
    '#f38ba8', // Red
    '#cba6f7', // Mauve
    '#fab387', // Peach
    '#94e2d5', // Teal
    '#f5c2e7', // Pink
    '#eba0ac', // Maroon
    '#f9e2af', // Yellow
    '#6c7086'  // Overlay Grey
  ],
};
