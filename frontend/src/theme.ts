import { createTheme, rem } from '@mantine/core';

export const theme = createTheme({
    fontFamily: 'Inter, sans-serif',
    primaryColor: 'brand',
    defaultRadius: 'lg',
    autoContrast: true,
    colors: {
        brand: [
            '#edf4ff',
            '#dce8ff',
            '#bfd4ff',
            '#94b7ff',
            '#6797ff',
            '#447bff',
            '#2b67fb',
            '#1d57e0',
            '#164abd',
            '#133f9a',
        ],
        sky: [
            '#ecfeff',
            '#cffafe',
            '#a5f3fc',
            '#67e8f9',
            '#22d3ee',
            '#06b6d4',
            '#0891b2',
            '#0e7490',
            '#155e75',
            '#164e63',
        ],
        slate: [
            '#f8fafc',
            '#f1f5f9',
            '#e2e8f0',
            '#cbd5e1',
            '#94a3b8',
            '#64748b',
            '#475569',
            '#334155',
            '#1e293b',
            '#0f172a',
        ],
    },
    defaultGradient: { from: 'brand.6', to: 'sky.5', deg: 135 },
    shadows: {
        xs: '0 1px 2px rgba(15, 23, 42, 0.04)',
        sm: '0 14px 32px -24px rgba(15, 23, 42, 0.28)',
        md: '0 18px 48px -26px rgba(37, 99, 235, 0.2)',
        lg: '0 28px 80px -38px rgba(15, 23, 42, 0.28)',
    },
    headings: {
        fontFamily: 'Inter, sans-serif',
        fontWeight: '800',
        sizes: {
            h1: { fontSize: rem(36), lineHeight: '1.2' },
            h2: { fontSize: rem(28), lineHeight: '1.3' },
            h3: { fontSize: rem(22), lineHeight: '1.4' },
        },
    },
    components: {
        Button: {
            defaultProps: {
                radius: 'xl',
                size: 'md',
                fw: 600,
            },
        },
        Paper: {
            defaultProps: {
                shadow: 'sm',
                radius: 'lg',
                withBorder: true,
            },
        },
    },
});
