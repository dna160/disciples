import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'newsroom-bg': '#0A0A0B',
        'newsroom-surface': '#111114',
        'newsroom-surface-2': '#1A1A1F',
        'newsroom-border': '#2A2A32',
        'newsroom-border-bright': '#3A3A45',
        'newsroom-text': '#E8E8F0',
        'newsroom-muted': '#6B6B80',
        'newsroom-amber': '#F59E0B',
        'newsroom-amber-dim': '#B45309',
        'newsroom-amber-glow': 'rgba(245, 158, 11, 0.15)',
        'newsroom-green': '#10B981',
        'newsroom-red': '#EF4444',
        'newsroom-blue': '#3B82F6',
        'newsroom-purple': '#8B5CF6',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'node-idle': 'node-idle-pulse 3s ease-in-out infinite',
        'node-working': 'node-working-pulse 1s ease-in-out infinite',
        'data-flow': 'data-flow 2s linear infinite',
        'terminal-entry': 'terminal-entry 0.2s ease-out forwards',
        'shake': 'shake 0.4s ease-in-out',
        'fade-in': 'fade-in 0.3s ease-out forwards',
        'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
      },
      keyframes: {
        'node-idle-pulse': {
          '0%, 100%': { opacity: '0.3' },
          '50%': { opacity: '0.8' },
        },
        'node-working-pulse': {
          '0%, 100%': { transform: 'scale(1)', boxShadow: '0 0 8px rgba(245, 158, 11, 0.4)' },
          '50%': { transform: 'scale(1.03)', boxShadow: '0 0 20px rgba(245, 158, 11, 0.8)' },
        },
        'data-flow': {
          '0%': { transform: 'translateX(0%)', opacity: '0' },
          '10%': { opacity: '1' },
          '90%': { opacity: '1' },
          '100%': { transform: 'translateX(100%)', opacity: '0' },
        },
        'terminal-entry': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'shake': {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%': { transform: 'translateX(-4px)' },
          '40%': { transform: 'translateX(4px)' },
          '60%': { transform: 'translateX(-4px)' },
          '80%': { transform: 'translateX(4px)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 5px rgba(245, 158, 11, 0.3)' },
          '50%': { boxShadow: '0 0 20px rgba(245, 158, 11, 0.7)' },
        },
      },
      boxShadow: {
        'amber-glow': '0 0 20px rgba(245, 158, 11, 0.4)',
        'amber-glow-sm': '0 0 10px rgba(245, 158, 11, 0.3)',
        'green-glow': '0 0 15px rgba(16, 185, 129, 0.4)',
        'red-glow': '0 0 15px rgba(239, 68, 68, 0.4)',
      },
    },
  },
  plugins: [],
}

export default config
