import { Theme } from '../interfaces/theme.interface';

/**
 * Sepia theme - Warm vintage tones
 * A nostalgic palette inspired by old photographs
 */
export const sepiaTheme: Theme = {
  id: 'sepia',
  name: 'Sepia',
  description: 'Warm vintage tones',
  colors: {
    // Background colors - Warm browns and tans
    bgPrimary: '#1a1612',
    bgSecondary: '#2a241f',
    bgTertiary: '#3a3229',
    bgElevated: '#4a4035',
    bgHover: '#5a4e42',

    // Accent colors - Rich sepia browns
    accentPrimary: '#c9a961',
    accentSecondary: '#d4b87a',
    accentDark: '#a68a4f',
    accentMuted: '#7d6b3d',
    accentSubtle: 'rgba(201, 169, 97, 0.15)',

    // Text colors - Warm creams and light browns
    textPrimary: '#f5f0e8',
    textSecondary: '#d4c5b0',
    textMuted: '#9d8e7a',
    textInverse: '#1a1612',

    // Border colors - Subtle brown separations
    border: '#5a4e42',
    borderLight: '#6a5e52',
    borderSubtle: '#3a3229',

    // Status colors - Warm tones with sepia influence
    success: '#8fb88f', // Muted green with brown tint
    warning: '#d4a574', // Warm amber-brown
    error: '#c98a6a',  // Muted red-brown
    info: '#9db5c9',    // Muted blue with brown tint

    // Shadows - Warm brown-based shadows
    shadowSm: '0 1px 3px rgba(0, 0, 0, 0.35)',
    shadowMd: '0 4px 12px rgba(0, 0, 0, 0.4)',
    shadowLg: '0 8px 24px rgba(0, 0, 0, 0.45)',
    shadowXl: '0 16px 48px rgba(0, 0, 0, 0.5)',
    shadowGlow: '0 0 24px rgba(201, 169, 97, 0.3)',
    shadowCard: '0 2px 8px rgba(0, 0, 0, 0.3), 0 0 1px rgba(0, 0, 0, 0.35)',
  },
};

