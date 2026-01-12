/**
 * Theme color configuration matching CSS custom properties
 */
export interface ThemeColors {
  // Background colors
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  bgElevated: string;
  bgHover: string;

  // Accent colors
  accentPrimary: string;
  accentSecondary: string;
  accentDark: string;
  accentMuted: string;
  accentSubtle: string;

  // Text colors
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;

  // Border colors
  border: string;
  borderLight: string;
  borderSubtle: string;

  // Status colors
  success: string;
  warning: string;
  error: string;
  info: string;

  // Shadows
  shadowSm: string;
  shadowMd: string;
  shadowLg: string;
  shadowXl: string;
  shadowGlow: string;
  shadowCard: string;
}

/**
 * Complete theme configuration
 */
export interface Theme {
  id: string;
  name: string;
  description?: string;
  colors: ThemeColors;
}

