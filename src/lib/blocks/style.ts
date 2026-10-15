import type { CSSProperties } from 'react';
import type { BlockStyle } from './types';
import type { SiteTheme } from '@/lib/types';

/**
 * Style keys the editor can set and the renderer can draw, in one place.
 *
 * Everything is token-first. A raw value is only accepted when it looks like a
 * length or a colour, because `styles` arrives from a jsonb column and an
 * unvalidated string interpolated into an inline style is how a stored payload
 * becomes markup the browser acts on. Anything unknown is dropped, not guessed.
 */

export const SPACE_STEPS = ['none', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'] as const;

const SPACE: Record<string, string> = {
  none: '0px',
  xs: '4px',
  sm: '8px',
  md: '16px',
  lg: '24px',
  xl: '32px',
  '2xl': '48px',
  '3xl': '72px',
};

const GAP: Record<string, string> = {
  none: '0px',
  xs: '4px',
  sm: '8px',
  md: '16px',
  lg: '24px',
  xl: '32px',
  '2xl': '48px',
  '3xl': '64px',
};

const FONT_SIZE: Record<string, string> = {
  xs: '12px',
  sm: '14px',
  md: '16px',
  lg: '19px',
  xl: '23px',
  '2xl': '30px',
  '3xl': '40px',
  '4xl': '52px',
  '5xl': '66px',
};

const RADIUS: Record<string, string> = {
  none: '0px',
  xs: '4px',
  sm: '6px',
  md: '8px',
  lg: '14px',
  xl: '22px',
  full: '999px',
};

const WEIGHT: Record<string, string> = {
  '300': '300',
  '400': '400',
  '500': '500',
  '600': '600',
  '700': '700',
  '800': '800',
};

const LINE_HEIGHT: Record<string, string> = {
  tight: '1.12',
  snug: '1.32',
  normal: '1.6',
  loose: '1.9',
};

const BORDER_WIDTH: Record<string, string> = {
  '1': '1px',
  '2': '2px',
  '3': '3px',
  '4': '4px',
  '6': '6px',
};

const SHADOW: Record<string, string> = {
  none: 'none',
  sm: '0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.08)',
  md: '0 4px 12px rgba(16,24,40,.10)',
  lg: '0 14px 34px rgba(16,24,40,.16)',
};

const LENGTH = /^(\d+(\.\d+)?)(px|rem|em|%)$/;
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function fromScale(value: unknown, scale: Record<string, string>): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  const hit = scale[value];
  if (hit) return hit;
  return LENGTH.test(value) ? value : undefined;
}

/** Theme colour by name, or a literal hex the workspace typed. */
export function colorValue(value: unknown, theme: SiteTheme): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  if (value === 'transparent') return 'transparent';
  if (HEX.test(value)) return value;
  const palette: Record<string, string | undefined> = {
    primary: theme.colors?.primary,
    surface: theme.colors?.surface,
    background: theme.colors?.background,
    text: theme.colors?.text,
    muted: theme.colors?.muted,
    border: theme.colors?.border,
  };
  return palette[value];
}

function toneBackground(tone: string, theme: SiteTheme): string | undefined {
  switch (tone) {
    case 'surface':
      return theme.colors?.surface;
    case 'muted':
      return theme.colors?.background;
    case 'primary':
      return theme.colors?.primary;
    case 'dark':
      return '#111827';
    default:
      return undefined;
  }
}

const WIDTHS: Record<string, string> = {
  narrow: '720px',
  wide: '1280px',
  full: '100%',
};

/**
 * Inline style for one block. `outer` carries the box (spacing, background,
 * width) that belongs to the element the canvas also needs to select, so both
 * walkers can share the box model without duplicating the maths.
 */
export function styleFor(
  styles: BlockStyle,
  theme: SiteTheme,
  extra?: { maxWidth?: string; center?: boolean },
): CSSProperties {
  const out: CSSProperties = {};

  if (styles.align === 'left' || styles.align === 'center' || styles.align === 'right') {
    out.textAlign = styles.align;
  }

  const color = colorValue(styles.color, theme);
  if (color) out.color = color;

  const background = colorValue(styles.background, theme);
  if (background) out.background = background;

  const padY = fromScale(styles.padding_y, SPACE);
  if (padY) out.paddingTop = padY;
  const padX = fromScale(styles.padding_x, SPACE);
  if (padX) out.paddingLeft = padX;

  const gap = fromScale(styles.gap, GAP);
  if (gap) out.gap = gap;

  const fontSize = fromScale(styles.font_size, FONT_SIZE);
  if (fontSize) out.fontSize = fontSize;

  const weight = typeof styles.font_weight === 'string' ? WEIGHT[styles.font_weight] : undefined;
  if (weight) out.fontWeight = Number(weight);

  const lineHeight = fromScale(styles.line_height, LINE_HEIGHT);
  if (lineHeight) out.lineHeight = lineHeight;

  const radius = fromScale(styles.radius, RADIUS) ?? (theme.radius ? fromScale(theme.radius, RADIUS) : undefined);
  if (radius && styles.radius) out.borderRadius = radius;

  const border = colorValue(styles.border_color, theme);
  const borderWidth = fromScale(styles.border_width, BORDER_WIDTH);
  if (border && borderWidth) {
    out.border = `${borderWidth} solid ${border}`;
  }

  if (styles.shadow && styles.shadow !== 'none') out.boxShadow = SHADOW[styles.shadow];
  if (styles.shadow === 'none') out.boxShadow = 'none';

  if (typeof styles.opacity === 'number') out.opacity = styles.opacity;

  if (typeof styles.columns === 'number') {
    out.display = 'grid';
    out.gridTemplateColumns = `repeat(${Math.min(6, Math.max(1, Math.trunc(styles.columns)))}, minmax(0, 1fr))`;
  }

  const width = styles.width ? WIDTHS[styles.width] ?? (styles.width === 'default' ? theme.max_width : undefined) : undefined;
  if (width) {
    out.maxWidth = width;
    if (width !== '100%') {
      out.marginLeft = 'auto';
      out.marginRight = 'auto';
    }
  } else if (extra?.maxWidth) {
    out.maxWidth = extra.maxWidth;
    if (extra.center !== false) {
      out.marginLeft = 'auto';
      out.marginRight = 'auto';
    }
  }

  return out;
}

/** What a page draws with when its site has no theme of its own yet. */
export const DEFAULT_THEME: SiteTheme = {
  colors: {
    primary: '#2E6BE6',
    surface: '#FFFFFF',
    background: '#F7F8FA',
    text: '#111827',
    muted: '#6B7280',
    border: '#E5E7EB',
  },
  fonts: { heading: 'Inter', body: 'Inter' },
  radius: '10px',
  max_width: '1200px',
  section_gap: '48px',
};

const HEX_ONLY = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const ONE_LENGTH = /^\d{1,4}(\.\d+)?(px|rem|%)$/;
type ThemeLength = 'radius' | 'max_width' | 'section_gap';

/**
 * A theme arrives from a jsonb column and may be `{}` or hold a value someone
 * typed into the database by hand. This turns any of that into a complete
 * `SiteTheme`, dropping anything the renderer could not safely draw — a colour
 * that is not hex or a size that is not a length falls back to the default
 * rather than reaching an inline style.
 */
export function normalizeTheme(value: unknown): SiteTheme {
  const raw = (value ?? {}) as Record<string, unknown>;
  const colors = (raw.colors ?? {}) as Record<string, unknown>;
  const fonts = (raw.fonts ?? {}) as Record<string, unknown>;

  const colour = (key: keyof SiteTheme['colors']): string => {
    const v = colors[key];
    return typeof v === 'string' && HEX_ONLY.test(v) ? v : DEFAULT_THEME.colors[key];
  };
  const length = (key: ThemeLength): string => {
    const v = raw[key];
    return typeof v === 'string' && ONE_LENGTH.test(v) ? v : DEFAULT_THEME[key];
  };
  // Font families are single words on purpose: the renderer writes them into
  // `font-family` unquoted, and a name with a space needs quotes to be valid.
  const font = (key: keyof SiteTheme['fonts']): string => {
    const v = fonts[key];
    return typeof v === 'string' && /^[A-Za-z][A-Za-z0-9-]{0,47}$/.test(v) ? v : DEFAULT_THEME.fonts[key];
  };

  return {
    colors: {
      primary: colour('primary'),
      surface: colour('surface'),
      background: colour('background'),
      text: colour('text'),
      muted: colour('muted'),
      border: colour('border'),
    },
    fonts: { heading: font('heading'), body: font('body') },
    radius: length('radius'),
    max_width: length('max_width'),
    section_gap: length('section_gap'),
  };
}

export function themeToVars(theme: SiteTheme): CSSProperties {
  const t = normalizeTheme(theme);
  const vars: Record<string, string> = {
    '--site-primary': t.colors.primary,
    '--site-surface': t.colors.surface,
    '--site-background': t.colors.background,
    '--site-text': t.colors.text,
    '--site-muted': t.colors.muted,
    '--site-border': t.colors.border,
    '--site-radius': t.radius,
    '--site-max': t.max_width,
    '--site-gap': t.section_gap,
  };

  return {
    ...vars,
    fontFamily: `${t.fonts.body}, ui-sans-serif, system-ui, sans-serif`,
    color: t.colors.text,
    background: t.colors.background,
  } as CSSProperties;
}

export function headingFont(theme: SiteTheme): string | undefined {
  return theme.fonts?.heading ? `${theme.fonts.heading}, ui-sans-serif, system-ui, sans-serif` : undefined;
}

export function sectionTone(tone: unknown, theme: SiteTheme): CSSProperties {
  if (typeof tone !== 'string' || tone === 'none') return {};
  const background = toneBackground(tone, theme);
  if (!background) return {};
  const dark = tone === 'primary' || tone === 'dark';
  return { background, color: dark ? (theme.colors?.surface ?? '#FFFFFF') : (theme.colors?.text ?? '#111827') };
}

/** The scale lists the style panel renders, so a choice is always drawable. */
export const STYLE_CHOICES = {
  align: [
    { value: '', label: 'Inherited' },
    { value: 'left', label: 'Left' },
    { value: 'center', label: 'Center' },
    { value: 'right', label: 'Right' },
  ],
  space: [
    { value: '', label: 'Theme' },
    ...SPACE_STEPS.map((value) => ({ value, label: value === 'none' ? 'None' : value })),
  ],
  fontSize: [
    { value: '', label: 'Theme' },
    ...Object.keys(FONT_SIZE).map((value) => ({ value, label: `${value} (${FONT_SIZE[value] ?? value})` })),
  ],
  weight: [
    { value: '', label: 'Theme' },
    { value: '400', label: 'Regular' },
    { value: '500', label: 'Medium' },
    { value: '600', label: 'Semibold' },
    { value: '700', label: 'Bold' },
    { value: '800', label: 'Extra bold' },
  ],
  lineHeight: [
    { value: '', label: 'Theme' },
    { value: 'tight', label: 'Tight' },
    { value: 'snug', label: 'Snug' },
    { value: 'normal', label: 'Normal' },
    { value: 'loose', label: 'Loose' },
  ],
  radius: [
    { value: '', label: 'Theme' },
    ...Object.keys(RADIUS).map((value) => ({ value, label: value === 'none' ? 'Square' : value })),
  ],
  borderWidth: [
    { value: '', label: 'None' },
    ...Object.keys(BORDER_WIDTH).map((value) => ({ value, label: BORDER_WIDTH[value] ?? value })),
  ],
  shadow: [
    { value: '', label: 'Theme' },
    { value: 'none', label: 'None' },
    { value: 'sm', label: 'Soft' },
    { value: 'md', label: 'Medium' },
    { value: 'lg', label: 'Strong' },
  ],
  width: [
    { value: '', label: 'Theme' },
    { value: 'narrow', label: 'Narrow' },
    { value: 'default', label: 'Content width' },
    { value: 'wide', label: 'Wide' },
    { value: 'full', label: 'Full width' },
  ],
} as const;
