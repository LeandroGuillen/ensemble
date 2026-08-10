/**
 * WCAG relative-luminance helpers for picking readable text on colored backgrounds.
 * @see https://www.w3.org/TR/WCAG20/#relativeluminancedef
 */

/** Relative luminance at which black and white text have equal contrast (~0.179). */
const LUMINANCE_CONTRAST_THRESHOLD = 0.179;

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/**
 * Parse `#RGB`, `#RRGGBB`, or `rgb()/rgba()` into 0–255 channels.
 * Returns null when the color cannot be parsed.
 */
export function parseCssColor(color: string): RgbColor | null {
  if (!color) {
    return null;
  }

  const trimmed = color.trim();

  if (trimmed.startsWith('#')) {
    const hex = trimmed.slice(1);
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
      };
    }
    if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      };
    }
    return null;
  }

  const rgbMatch = trimmed.match(
    /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/i
  );
  if (rgbMatch) {
    return {
      r: Math.min(255, Math.max(0, Number(rgbMatch[1]))),
      g: Math.min(255, Math.max(0, Number(rgbMatch[2]))),
      b: Math.min(255, Math.max(0, Number(rgbMatch[3]))),
    };
  }

  return null;
}

function channelToLinear(channel: number): number {
  const srgb = channel / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance for an sRGB color (0 = black, 1 = white). */
export function relativeLuminance(color: string | RgbColor): number {
  const rgb = typeof color === 'string' ? parseCssColor(color) : color;
  if (!rgb) {
    return 0;
  }
  return (
    0.2126 * channelToLinear(rgb.r) +
    0.7152 * channelToLinear(rgb.g) +
    0.0722 * channelToLinear(rgb.b)
  );
}

/**
 * Pick black or white text for the given background using WCAG relative luminance.
 */
export function contrastTextColor(
  backgroundColor: string,
  lightText = '#ffffff',
  darkText = '#000000'
): string {
  const luminance = relativeLuminance(backgroundColor);
  return luminance > LUMINANCE_CONTRAST_THRESHOLD ? darkText : lightText;
}
