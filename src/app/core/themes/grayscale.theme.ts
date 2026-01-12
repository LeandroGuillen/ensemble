import { Theme } from '../interfaces/theme.interface';

/**
 * Grayscale theme - Elegant monochrome palette
 * A sophisticated black, white, and gray theme
 */
export const grayscaleTheme: Theme = {
  id: 'grayscale',
  name: 'Grayscale',
  description: 'Elegant monochrome palette',
  colors: {
    // Background colors - Various shades of gray
    bgPrimary: '#0a0a0a',
    bgSecondary: '#141414',
    bgTertiary: '#1f1f1f',
    bgElevated: '#2a2a2a',
    bgHover: '#353535',

    // Accent colors - Light gray for highlights
    accentPrimary: '#9ca3af',
    accentSecondary: '#d1d5db',
    accentDark: '#6b7280',
    accentMuted: '#4b5563',
    accentSubtle: 'rgba(156, 163, 175, 0.1)',

    // Text colors - High contrast for readability
    textPrimary: '#f9fafb',
    textSecondary: '#e5e7eb',
    textMuted: '#9ca3af',
    textInverse: '#0a0a0a',

    // Border colors - Subtle gray separations
    border: '#374151',
    borderLight: '#4b5563',
    borderSubtle: '#1f2937',

    // Status colors - Subtle grayscale versions with slight hints
    success: '#6ee7b7', // Light green-gray
    warning: '#fbbf24', // Keep some warmth for visibility
    error: '#f87171',   // Keep some warmth for visibility
    info: '#93c5fd',    // Light blue-gray

    // Shadows - Gray-based shadows
    shadowSm: '0 1px 3px rgba(0, 0, 0, 0.4)',
    shadowMd: '0 4px 12px rgba(0, 0, 0, 0.45)',
    shadowLg: '0 8px 24px rgba(0, 0, 0, 0.5)',
    shadowXl: '0 16px 48px rgba(0, 0, 0, 0.55)',
    shadowGlow: '0 0 24px rgba(156, 163, 175, 0.2)',
    shadowCard: '0 2px 8px rgba(0, 0, 0, 0.3), 0 0 1px rgba(0, 0, 0, 0.4)',
  },
  colorPalette: [
    '#9ca3af', // Light Gray Blue
    '#a1a1a1', // Medium Gray Green
    '#8b8b8b', // Dark Gray Red
    '#7a7a7a', // Medium Gray Purple
    '#b8b8b8', // Light Gray Orange
    '#6b7280', // Dark Gray Teal
    '#a8a8a8', // Light Gray Pink
    '#9a9a9a', // Medium Gray Deep Orange
    '#d1d5db', // Very Light Gray Yellow
    '#4b5563'  // Dark Gray Blue-Grey
  ],
};

