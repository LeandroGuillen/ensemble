import { Theme } from '../interfaces/theme.interface';

/**
 * Blue Gold theme - Deep navy with warm amber accents
 * This is the default theme extracted from the original styles
 */
export const blueGoldTheme: Theme = {
  id: 'blue-gold',
  name: 'Blue Gold',
  description: 'Deep navy with warm amber accents',
  colors: {
    // Background colors
    bgPrimary: '#0c0f14',
    bgSecondary: '#12161e',
    bgTertiary: '#1a1f2b',
    bgElevated: '#222838',
    bgHover: '#2a3142',

    // Accent colors - Warm amber/gold
    accentPrimary: '#e5a855',
    accentSecondary: '#f0c074',
    accentDark: '#c48b3a',
    accentMuted: '#8b6b33',
    accentSubtle: 'rgba(229, 168, 85, 0.1)',

    // Text colors
    textPrimary: '#f2f4f7',
    textSecondary: '#a0a8b8',
    textMuted: '#6b7280',
    textInverse: '#0c0f14',

    // Border colors
    border: '#2a3142',
    borderLight: '#3a4256',
    borderSubtle: '#1e2330',

    // Status colors
    success: '#4ade80',
    warning: '#fbbf24',
    error: '#f87171',
    info: '#60a5fa',

    // Shadows
    shadowSm: '0 1px 3px rgba(0, 0, 0, 0.3)',
    shadowMd: '0 4px 12px rgba(0, 0, 0, 0.35)',
    shadowLg: '0 8px 24px rgba(0, 0, 0, 0.4)',
    shadowXl: '0 16px 48px rgba(0, 0, 0, 0.45)',
    shadowGlow: '0 0 24px rgba(229, 168, 85, 0.25)',
    shadowCard: '0 2px 8px rgba(0, 0, 0, 0.25), 0 0 1px rgba(0, 0, 0, 0.3)',
  },
};

