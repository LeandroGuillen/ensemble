/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts}",
  ],
  theme: {
    extend: {
      // Modern color palette - Deep navy with warm amber accents
      colors: {
        // Background colors - Rich, layered navy tones
        bg: {
          primary: '#0c0f14',
          secondary: '#12161e',
          tertiary: '#1a1f2b',
          elevated: '#222838',
          hover: '#2a3142',
        },
        // Accent colors - Warm amber/gold for distinction
        accent: {
          DEFAULT: '#e5a855',
          primary: '#e5a855',
          secondary: '#f0c074',
          dark: '#c48b3a',
          muted: '#8b6b33',
          subtle: 'rgba(229, 168, 85, 0.1)',
        },
        // Text colors - Improved contrast hierarchy
        content: {
          primary: '#f2f4f7',
          secondary: '#a0a8b8',
          muted: '#6b7280',
          inverse: '#0c0f14',
        },
        // Border colors - Subtle separations
        border: {
          DEFAULT: '#2a3142',
          light: '#3a4256',
          subtle: '#1e2330',
        },
        // Status colors - Refined for dark theme
        success: '#4ade80',
        warning: '#fbbf24',
        error: '#f87171',
        info: '#60a5fa',
      },
      // Typography - Modern, refined font stack
      fontFamily: {
        sans: ['Outfit', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        display: ['Outfit', 'system-ui', 'sans-serif'],
      },
      // Refined spacing scale
      spacing: {
        'xs': '4px',
        'sm': '8px',
        'md': '12px',
        'lg': '16px',
        'xl': '24px',
        '2xl': '32px',
        '3xl': '48px',
        '4xl': '64px',
      },
      // Softer border radius
      borderRadius: {
        'sm': '4px',
        'md': '8px',
        'lg': '12px',
        'xl': '16px',
        '2xl': '24px',
      },
      // Refined shadows for depth
      boxShadow: {
        'sm': '0 1px 3px rgba(0, 0, 0, 0.3)',
        'md': '0 4px 12px rgba(0, 0, 0, 0.35)',
        'lg': '0 8px 24px rgba(0, 0, 0, 0.4)',
        'xl': '0 16px 48px rgba(0, 0, 0, 0.45)',
        'glow': '0 0 24px rgba(229, 168, 85, 0.25)',
        'glow-sm': '0 0 12px rgba(229, 168, 85, 0.15)',
        'inner-glow': 'inset 0 0 20px rgba(229, 168, 85, 0.08)',
        'card': '0 2px 8px rgba(0, 0, 0, 0.25), 0 0 1px rgba(0, 0, 0, 0.3)',
        'card-hover': '0 8px 24px rgba(0, 0, 0, 0.35), 0 0 1px rgba(229, 168, 85, 0.2)',
      },
      // Smooth transitions
      transitionDuration: {
        'fast': '120ms',
        'base': '200ms',
        'slow': '350ms',
      },
      // Polished animations
      animation: {
        'spin-slow': 'spin 2s linear infinite',
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-down': 'slideDown 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-left': 'slideLeft 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-right': 'slideRight 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in': 'scaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        'shimmer': 'shimmer 2s linear infinite',
        'glow-pulse': 'glowPulse 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideLeft: {
          '0%': { opacity: '0', transform: 'translateX(12px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        slideRight: {
          '0%': { opacity: '0', transform: 'translateX(-12px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        glowPulse: {
          '0%, 100%': { boxShadow: '0 0 8px rgba(229, 168, 85, 0.2)' },
          '50%': { boxShadow: '0 0 20px rgba(229, 168, 85, 0.35)' },
        },
      },
      // Typography scale
      fontSize: {
        'xs': ['0.75rem', { lineHeight: '1.1rem' }],
        'sm': ['0.875rem', { lineHeight: '1.35rem' }],
        'base': ['1rem', { lineHeight: '1.6' }],
        'lg': ['1.125rem', { lineHeight: '1.7rem' }],
        'xl': ['1.25rem', { lineHeight: '1.8rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.3rem' }],
        '4xl': ['2.25rem', { lineHeight: '2.7rem' }],
        '5xl': ['3rem', { lineHeight: '1.25' }],
      },
      // Width utilities
      minWidth: {
        'xs': '20rem',
        'sm': '24rem',
        'md': '28rem',
        'lg': '32rem',
        'xl': '36rem',
      },
      maxWidth: {
        'container': '1400px',
        'narrow': '800px',
        'wide': '1600px',
      },
      // Z-index scale
      zIndex: {
        'dropdown': '100',
        'sticky': '200',
        'modal': '1000',
        'popover': '1100',
        'tooltip': '1200',
        'toast': '1300',
      },
      // Gradient backgrounds
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
        'shimmer': 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.03) 50%, transparent 100%)',
        'glass': 'linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)',
        'accent-gradient': 'linear-gradient(135deg, #e5a855 0%, #c48b3a 100%)',
        'card-gradient': 'linear-gradient(145deg, rgba(26, 31, 43, 0.8) 0%, rgba(18, 22, 30, 0.9) 100%)',
      },
      backdropBlur: {
        'xs': '2px',
        'sm': '4px',
      },
    },
  },
  plugins: [],
}
