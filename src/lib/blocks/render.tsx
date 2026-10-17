import type { CSSProperties, ReactNode } from 'react';
import type { BlockNode, BlockStyle } from './types';
import { REGISTRY } from './registry';
import { richTextToHtml, richTextToPlain } from '@/lib/richtext';
import type { SiteTheme } from '@/lib/types';
import { colorValue, headingFont, sectionTone, styleFor } from './style';

/**
 * One renderer for every block, used by the published page and by the builder's
 * canvas. Keeping them in a single module is the only reason a block looks the
 * same while it is being edited as it does once it is live — two implementations
 * drift within a week.
 *
 * Containers (`section`, `container`, `columns`) are the caller's business: the
 * published tree walks them, the canvas wraps each child in a drop target. This
 * module draws leaf content and exposes the container box styles.
 */

export interface EmbedEntity {
  id: string;
  label: string;
  slug?: string;
}

/**
 * A product the Inventory app is showing on a site.
 *
 * `price` arrives already formatted, because the workspace's currency and locale
 * belong to whoever read the row out of the database, not to a block that has to
 * render the same way in a canvas and on a live page.
 */
export interface RenderProduct {
  id: string;
  name: string;
  price: string;
  body: string;
  image: string;
}

export interface RenderContext {
  theme: SiteTheme;
  /** `live` renders the real page; `canvas` marks unresolved embeds instead of framing 404s. */
  mode: 'live' | 'canvas';
  /** Where this site is served from, e.g. `/s/acme/shop`. */
  basePath: string;
  forms: Record<string, EmbedEntity>;
  services: Record<string, EmbedEntity>;
  staff: Record<string, EmbedEntity>;
  products: RenderProduct[];
}

const SCHEME_SAFE = /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i;
const IMAGE_SAFE = /^(https?:\/\/|\/(?!\/))/;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown, fallback: number): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  // A select stores its value as a string, so `level: '3'` and `columns: '4'`
  // arrive as text. Reading only real numbers made every numeric choice in the
  // inspector silently fall back to the default.
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function flag(value: unknown): boolean {
  return value === true;
}

type Item = Record<string, unknown>;

function items(value: unknown): Item[] {
  return Array.isArray(value) ? (value.filter((v) => v && typeof v === 'object') as Item[]) : [];
}

/** A link the browser may follow. Everything else collapses to nothing. */
export function safeHref(value: unknown): string {
  const raw = text(value).trim();
  return raw !== '' && SCHEME_SAFE.test(raw) ? raw : '';
}

export function siteHref(value: unknown, ctx: RenderContext): string {
  const raw = safeHref(value);
  if (raw === '') return '';
  if (raw.startsWith('/')) return `${ctx.basePath}${raw === '/' ? '' : raw}`;
  return raw;
}

function imageSrc(value: unknown): string {
  const raw = text(value).trim();
  return IMAGE_SAFE.test(raw) ? raw : '';
}

function propStyles(node: BlockNode): BlockStyle {
  return node.styles ?? {};
}

// --- shared pieces ----------------------------------------------------------

function Prose({ source, className, style }: { source: unknown; className?: string; style?: CSSProperties }) {
  const html = richTextToHtml(source);
  if (html === '') return null;
  return <div className={className} style={style} dangerouslySetInnerHTML={{ __html: html }} />;
}

function buttonPrimary(theme: SiteTheme): CSSProperties {
  return {
    background: theme.colors?.primary ?? '#2E6BE6',
    color: theme.colors?.surface ?? '#FFFFFF',
    border: '1px solid transparent',
  };
}

/** The sign-up block's reply line, shown only when the URL names it. */
function replyStyle(theme: SiteTheme): CSSProperties {
  return { margin: '10px 0 0', fontSize: '13px', color: theme.colors?.muted ?? '#6B7280' };
}

const BUTTON_VARIANTS: Record<string, (theme: SiteTheme) => CSSProperties> = {
  primary: buttonPrimary,
  secondary: (t) => ({
    background: t.colors?.surface ?? '#FFFFFF',
    color: t.colors?.text ?? '#111827',
    border: `1px solid ${t.colors?.border ?? '#E5E7EB'}`,
  }),
  ghost: () => ({ background: 'transparent', color: 'inherit', border: '1px solid transparent' }),
  outline: (t) => ({
    background: 'transparent',
    color: t.colors?.primary ?? '#2E6BE6',
    border: `1px solid ${t.colors?.primary ?? '#2E6BE6'}`,
  }),
};

function buttonSize(size: string | undefined): CSSProperties {
  if (size === 'sm') return { padding: '7px 14px', fontSize: '13px' };
  if (size === 'lg') return { padding: '13px 24px', fontSize: '16px' };
  return { padding: '10px 18px', fontSize: '14.5px' };
}

function ButtonLink({
  label,
  href,
  variant,
  size,
  newTab,
  theme,
}: {
  label: string;
  href: string;
  variant?: string;
  size?: string;
  newTab?: boolean;
  theme: SiteTheme;
}) {
  const style: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    borderRadius: theme.radius ?? '8px',
    fontWeight: 600,
    textDecoration: 'none',
    cursor: 'pointer',
    lineHeight: 1.2,
    ...(BUTTON_VARIANTS[variant ?? 'primary'] ?? buttonPrimary)(theme),
    ...buttonSize(size),
  };

  if (!href) {
    return (
      <span style={{ ...style, opacity: 0.55 }}>{label || 'Button'}</span>
    );
  }

  return (
    <a
      href={href}
      style={style}
      {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {label || 'Button'}
    </a>
  );
}

function Stars({ count }: { count: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(count)));
  if (filled === 0) return null;
  return (
    <span aria-label={`${filled} out of 5`} style={{ color: '#F5A623', letterSpacing: '2px', fontSize: '14px' }}>
      {'★'.repeat(filled)}
      <span style={{ color: '#D5D9E0' }}>{'★'.repeat(5 - filled)}</span>
    </span>
  );
}

function EmptyNote({ label }: { label: string }) {
  return (
    <p
      style={{
        margin: 0,
        padding: '14px 16px',
        border: '1px dashed #C9D1DB',
        borderRadius: '8px',
        color: '#6B7280',
        fontSize: '13px',
        background: '#FAFBFC',
      }}
    >
      {label}
    </p>
  );
}

function Figure({
  src,
  alt,
  ratio,
  fit,
  radius,
  circle,
}: {
  src: string;
  alt: string;
  ratio?: string;
  fit?: string;
  radius?: string;
  circle?: boolean;
}) {
  if (!src) return <EmptyNote label="No image selected yet." />;
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      style={{
        display: 'block',
        width: '100%',
        height: ratio && ratio !== 'auto' ? 'auto' : undefined,
        aspectRatio: ratio && ratio !== 'auto' ? ratio : undefined,
        objectFit: (fit === 'contain' ? 'contain' : 'cover') as CSSProperties['objectFit'],
        borderRadius: circle ? '50%' : (radius ?? '8px'),
      }}
    />
  );
}

// --- video ------------------------------------------------------------------

const YOUTUBE = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,20})/;
const VIMEO = /vimeo\.com\/(\d{4,12})/;

function videoFrame(url: string): { src: string; label: string } | null {
  const yt = YOUTUBE.exec(url);
  if (yt?.[1]) return { src: `https://www.youtube-nocookie.com/embed/${yt[1]}`, label: 'YouTube video' };
  const vm = VIMEO.exec(url);
  if (vm?.[1]) return { src: `https://player.vimeo.com/video/${vm[1]}`, label: 'Vimeo video' };
  return null;
}

// --- social -----------------------------------------------------------------

const SOCIAL: Record<string, { label: string; path: ReactNode }> = {
  instagram: {
    label: 'Instagram',
    path: <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.2" cy="6.8" r="1.2" /></>,
  },
  facebook: { label: 'Facebook', path: <path d="M14 8.5h2.5V5.5H14a3.5 3.5 0 0 0-3.5 3.5V11H8v3h2.5v5h3v-5H16l.5-3h-3V9.2A.7.7 0 0 1 14 8.5z" /> },
  linkedin: {
    label: 'LinkedIn',
    path: <><path d="M6 9.5v8M6 6.2v.1" /><path d="M10.5 17.5v-8M10.5 12.5a2.6 2.6 0 0 1 5 1.2v3.8" /></>,
  },
  x: { label: 'X', path: <path d="M5 5l14 14M19 5L5 19" /> },
  youtube: {
    label: 'YouTube',
    path: <><rect x="2.5" y="6" width="19" height="12" rx="4" /><path d="M10.5 9.6l4.5 2.4-4.5 2.4z" /></>,
  },
  whatsapp: {
    label: 'WhatsApp',
    path: <><path d="M4 20l1.4-4.2A8 8 0 1 1 8.2 18.6z" /><path d="M9 9.8c.4 2 2 3.4 4 3.8" /></>,
  },
};

function SocialGlyph({ network }: { network: string }) {
  const entry = SOCIAL[network];
  if (!entry) return null;
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {entry.path}
    </svg>
  );
}

// --- map --------------------------------------------------------------------

function mapFrame(query: string, zoom: number): string {
  const params = new URLSearchParams({ q: query, z: String(zoom), output: 'embed' });
  return `https://maps.google.com/maps?${params.toString()}`;
}

// --- the block switch -------------------------------------------------------

/**
 * A repeat grid whose column count is chosen in the inspector.
 *
 * The wrapper is a *container query* context rather than the grid itself, and the
 * count lives in `data-cols` with the sizing in globals.css, because the builder
 * previews a phone by shrinking a container while the real viewport stays at
 * desktop width. A media query would then refuse to collapse the grid in the
 * canvas, and an inline `grid-template-columns` would outrank the responsive
 * rules that make it collapse.
 */
function Grid({ columns, gap, children }: { columns: unknown; gap: string; children: ReactNode }) {
  const count = Math.max(1, Math.min(4, Math.round(num(columns, 3))));
  return (
    <div style={{ containerType: 'inline-size' }}>
      <div className="yb-grid" data-cols={count} style={{ gap }}>
        {children}
      </div>
    </div>
  );
}

/**
 * Content only: no outer box, no spacing. The walker that calls this owns the
 * wrapper element so the canvas can put a selection frame around the same markup
 * the live page produces.
 */
export function renderBlock(node: BlockNode, ctx: RenderContext): ReactNode {
  const p = node.props ?? {};
  const styles = propStyles(node);
  const theme = ctx.theme;

  switch (node.type) {
    case 'heading': {
      const level = Math.max(1, Math.min(4, num(p.level, 2)));
      const Tag = (`h${level}`) as 'h1' | 'h2' | 'h3' | 'h4';
      const size = styles.font_size ? undefined : ['40px', '31px', '24px', '19px'][level - 1];
      return (
        <Tag
          style={{
            margin: 0,
            lineHeight: 1.2,
            fontFamily: headingFont(theme),
            color: colorValue(styles.color, theme),
            ...(size ? { fontSize: size } : {}),
            ...styleFor(styles, theme),
          }}
        >
          {text(p.text) || (ctx.mode === 'canvas' ? 'New heading' : '')}
        </Tag>
      );
    }

    case 'text':
      return (
        <Prose
          source={p.html}
          className="prose-block"
          style={{ fontSize: '16px', lineHeight: 1.65, color: colorValue(styles.color, theme) ?? 'inherit', ...styleFor(styles, theme) }}
        />
      );

    case 'image': {
      const src = imageSrc(p.src);
      return (
        <figure style={{ margin: 0, ...styleFor(styles, theme) }}>
          <Figure src={src} alt={text(p.alt)} ratio={text(p.ratio)} fit={text(p.fit)} radius={theme.radius} />
          {text(p.caption) && (
            <figcaption style={{ marginTop: '8px', fontSize: '13px', color: theme.colors?.muted ?? '#6B7280' }}>
              {text(p.caption)}
            </figcaption>
          )}
        </figure>
      );
    }

    case 'button':
      return (
        <span style={{ display: 'inline-block', ...styleFor(styles, theme) }}>
          <ButtonLink
            label={text(p.label)}
            href={siteHref(p.href, ctx)}
            variant={text(p.variant)}
            size={text(p.size)}
            newTab={flag(p.new_tab)}
            theme={theme}
          />
        </span>
      );

    case 'button_group':
      return (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '10px',
            justifyContent:
              p.align === 'center' ? 'center' : p.align === 'right' ? 'flex-end' : 'flex-start',
            ...styleFor(styles, theme),
          }}
        >
          {items(p.items).map((item, index) => (
            <ButtonLink
              key={index}
              label={text(item.label)}
              href={siteHref(item.href, ctx)}
              variant={text(item.variant)}
              newTab={flag(item.new_tab)}
              theme={theme}
            />
          ))}
        </div>
      );

    case 'divider':
      return (
        <hr
          style={{
            border: 0,
            borderTop: `${text(p.weight) || '1px'} solid ${colorValue(styles.border_color, theme) ?? theme.colors?.border ?? '#E5E7EB'}`,
            margin: 0,
            ...styleFor(styles, theme),
          }}
        />
      );

    case 'spacer':
      return <div aria-hidden="true" style={{ height: `${num(p.height, 32)}px`, ...styleFor(styles, theme) }} />;

    case 'list': {
      const entries = items(p.items);
      const marker = text(p.style);
      const listStyle = marker === 'decimal' ? 'decimal' : marker === 'check' ? 'none' : 'disc';
      const ListTag = marker === 'decimal' ? 'ol' : 'ul';
      return (
        <ListTag
          style={{
            margin: 0,
            paddingLeft: marker === 'check' ? 0 : '22px',
            listStyleType: listStyle,
            lineHeight: 1.75,
            ...styleFor(styles, theme),
          }}
        >
          {entries.map((entry, index) => (
            <li key={index} style={marker === 'check' ? { display: 'flex', gap: '8px', alignItems: 'flex-start' } : undefined}>
              {marker === 'check' && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={theme.colors?.primary ?? '#2E6BE6'} strokeWidth="2.4" strokeLinecap="round" style={{ flex: 'none', marginTop: '4px' }} aria-hidden="true">
                  <path d="M4 12.5l5 5L20 6.5" />
                </svg>
              )}
              <span>{text(entry.text)}</span>
            </li>
          ))}
        </ListTag>
      );
    }

    case 'quote':
      return (
        <blockquote
          style={{
            margin: 0,
            padding: '4px 0 4px 18px',
            borderLeft: `3px solid ${theme.colors?.primary ?? '#2E6BE6'}`,
            fontSize: '19px',
            fontStyle: 'italic',
            lineHeight: 1.55,
            ...styleFor(styles, theme),
          }}
        >
          <p style={{ margin: 0 }}>{text(p.text)}</p>
          {text(p.attribution) && (
            <footer style={{ marginTop: '10px', fontSize: '14px', fontStyle: 'normal', color: theme.colors?.muted ?? '#6B7280' }}>
              — {text(p.attribution)}
            </footer>
          )}
        </blockquote>
      );

    case 'badge_row':
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', ...styleFor(styles, theme) }}>
          {items(p.items).map((badge, index) => (
            <span
              key={index}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '5px 12px',
                borderRadius: '999px',
                background: theme.colors?.background ?? '#F7F8FA',
                border: `1px solid ${theme.colors?.border ?? '#E5E7EB'}`,
                fontSize: '13px',
                fontWeight: 500,
              }}
            >
              {text(badge.text)}
            </span>
          ))}
        </div>
      );

    case 'video': {
      const url = safeHref(p.url);
      const frame = url.startsWith('http') ? videoFrame(url) : null;
      if (!frame) {
        return <EmptyNote label={ctx.mode === 'canvas' ? 'Paste a YouTube or Vimeo link in the panel on the right.' : 'Video unavailable.'} />;
      }
      return (
        <div style={{ ...styleFor(styles, theme) }}>
          <div style={{ position: 'relative', aspectRatio: '16 / 9', borderRadius: theme.radius ?? '10px', overflow: 'hidden', background: '#0B1220' }}>
            <iframe
              src={frame.src}
              title={text(p.title) || frame.label}
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
              referrerPolicy="no-referrer"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
            />
          </div>
        </div>
      );
    }

    case 'feature_row': {
      const image = imageSrc(p.image);
      const flip = p.image_side === 'left';
      const copy = (
        <div>
          {text(p.eyebrow) && (
            <p style={{ margin: '0 0 8px', fontSize: '12.5px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: theme.colors?.primary ?? '#2E6BE6' }}>
              {text(p.eyebrow)}
            </p>
          )}
          <h3 style={{ margin: '0 0 12px', fontSize: '27px', lineHeight: 1.25, fontFamily: headingFont(theme) }}>{text(p.title)}</h3>
          <Prose source={p.body} className="prose-block" style={{ margin: 0, fontSize: '16px', lineHeight: 1.65, color: theme.colors?.muted ?? '#4B5563' }} />
          {(text(p.button_label) || text(p.button_href)) && (
            <div style={{ marginTop: '20px' }}>
              <ButtonLink label={text(p.button_label)} href={siteHref(p.button_href, ctx)} theme={theme} />
            </div>
          )}
        </div>
      );
      const media = image ? (
        <Figure src={image} alt={text(p.title)} ratio="4/3" radius={theme.radius} />
      ) : (
        <div style={{ minHeight: '220px', borderRadius: theme.radius ?? '10px', background: theme.colors?.background ?? '#F7F8FA', border: `1px solid ${theme.colors?.border ?? '#E5E7EB'}` }} />
      );
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '32px', alignItems: 'center', ...styleFor(styles, theme) }}>
          {flip ? media : null}
          {copy}
          {flip ? null : media}
        </div>
      );
    }

    case 'card_grid': {
      return (
        <div style={{ ...styleFor(styles, theme) }}>
          {(text(p.title) || text(p.subtitle)) && (
            <div style={{ marginBottom: '26px' }}>
              <h2 style={{ margin: 0, fontSize: '29px', lineHeight: 1.2, fontFamily: headingFont(theme) }}>{text(p.title)}</h2>
              {text(p.subtitle) && <p style={{ margin: '10px 0 0', color: theme.colors?.muted ?? '#6B7280', maxWidth: '62ch' }}>{text(p.subtitle)}</p>}
            </div>
          )}
          <Grid columns={p.columns} gap="20px">
            {items(p.items).map((card, index) => {
              const inner = (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    padding: '20px',
                    height: '100%',
                    borderRadius: theme.radius ?? '10px',
                    border: `1px solid ${theme.colors?.border ?? '#E5E7EB'}`,
                    background: theme.colors?.surface ?? '#FFFFFF',
                    boxShadow: styles.shadow && styles.shadow !== 'none' ? undefined : '0 1px 2px rgba(16,24,40,.05)',
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  {imageSrc(card.image) && <Figure src={imageSrc(card.image)} alt={text(card.title)} ratio="16/9" radius={theme.radius} />}
                  <h3 style={{ margin: 0, fontSize: '18px', fontFamily: headingFont(theme) }}>{text(card.title)}</h3>
                  {text(card.body) && <p style={{ margin: 0, fontSize: '14.5px', lineHeight: 1.6, color: theme.colors?.muted ?? '#6B7280' }}>{text(card.body)}</p>}
                  {text(card.href) && <span style={{ marginTop: 'auto', fontSize: '14px', fontWeight: 600, color: theme.colors?.primary ?? '#2E6BE6' }}>Learn more →</span>}
                </div>
              );
              const href = siteHref(card.href, ctx);
              return (
                <div key={index}>
                  {href ? (
                    <a href={href} style={{ textDecoration: 'none', color: 'inherit', display: 'block', height: '100%' }}>
                      {inner}
                    </a>
                  ) : (
                    inner
                  )}
                </div>
              );
            })}
          </Grid>
        </div>
      );
    }

    case 'pricing_table':
      return (
        <div style={{ ...styleFor(styles, theme) }}>
          {(text(p.title) || text(p.subtitle)) && (
            <div style={{ marginBottom: '26px', textAlign: styles.align ?? 'center' }}>
              <h2 style={{ margin: 0, fontSize: '29px', fontFamily: headingFont(theme) }}>{text(p.title)}</h2>
              {text(p.subtitle) && <p style={{ margin: '10px 0 0', color: theme.colors?.muted ?? '#6B7280' }}>{text(p.subtitle)}</p>}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px', alignItems: 'stretch' }}>
            {items(p.plans).map((plan, index) => {
              const highlighted = plan.highlighted === true;
              const features = text(plan.features)
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean);
              return (
                <div
                  key={index}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    padding: '26px 22px',
                    borderRadius: theme.radius ?? '12px',
                    border: `1px solid ${highlighted ? (theme.colors?.primary ?? '#2E6BE6') : (theme.colors?.border ?? '#E5E7EB')}`,
                    background: highlighted ? (theme.colors?.primary ?? '#2E6BE6') : (theme.colors?.surface ?? '#FFFFFF'),
                    color: highlighted ? (theme.colors?.surface ?? '#FFFFFF') : 'inherit',
                  }}
                >
                  <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, opacity: 0.85 }}>{text(plan.name)}</p>
                  <p style={{ margin: 0, fontSize: '32px', fontWeight: 700, lineHeight: 1.1 }}>{text(plan.price)}</p>
                  {text(plan.period) && <p style={{ margin: '-6px 0 0', fontSize: '13px', opacity: 0.7 }}>{text(plan.period)}</p>}
                  {text(plan.body) && <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.55, opacity: 0.85 }}>{text(plan.body)}</p>}
                  <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: '8px', fontSize: '14px' }}>
                    {features.map((feature, i) => (
                      <li key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" style={{ flex: 'none', marginTop: '3px' }} aria-hidden="true">
                          <path d="M4 12.5l5 5L20 6.5" />
                        </svg>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <div style={{ marginTop: 'auto', paddingTop: '14px' }}>
                    <ButtonLink
                      label={text(plan.name) ? `Choose ${text(plan.name)}` : 'Choose'}
                      href={siteHref(plan.href, ctx)}
                      variant={highlighted ? 'secondary' : 'primary'}
                      size="sm"
                      theme={theme}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );

    case 'gallery': {
      const images = items(p.images);
      return (
        <div style={{ ...styleFor(styles, theme) }}>
          {text(p.title) && <h2 style={{ margin: '0 0 20px', fontSize: '27px', fontFamily: headingFont(theme) }}>{text(p.title)}</h2>}
          <Grid columns={p.columns} gap="14px">
            {images.map((image, index) => {
              const tile = <Figure src={imageSrc(image.src)} alt={text(image.alt)} ratio={text(p.ratio) || '1/1'} radius={theme.radius} />;
              const href = siteHref(image.href, ctx);
              return (
                <div key={index}>
                  {href ? (
                    <a href={href} style={{ display: 'block' }}>
                      {tile}
                    </a>
                  ) : (
                    tile
                  )}
                </div>
              );
            })}
          </Grid>
        </div>
      );
    }

    case 'faq':
      return (
        <div style={{ ...styleFor(styles, theme) }}>
          {text(p.title) && <h2 style={{ margin: '0 0 18px', fontSize: '27px', fontFamily: headingFont(theme) }}>{text(p.title)}</h2>}
          <div style={{ display: 'grid', gap: '10px', maxWidth: '760px', margin: styles.align === 'center' ? '0 auto' : undefined }}>
            {items(p.items).map((entry, index) => (
              <details
                key={index}
                style={{ border: `1px solid ${theme.colors?.border ?? '#E5E7EB'}`, borderRadius: theme.radius ?? '8px', background: theme.colors?.surface ?? '#FFFFFF', padding: '0 16px' }}
              >
                <summary style={{ cursor: 'pointer', fontWeight: 600, padding: '14px 0', listStyle: 'none' }}>{text(entry.question)}</summary>
                <p style={{ margin: '0 0 16px', lineHeight: 1.6, color: theme.colors?.muted ?? '#4B5563' }}>{text(entry.answer)}</p>
              </details>
            ))}
          </div>
        </div>
      );

    case 'stats':
      return (
        <div style={{ ...styleFor(styles, theme) }}>
          <Grid columns={p.columns} gap="20px">
            {items(p.items).map((stat, index) => (
              <div key={index}>
                <p style={{ margin: 0, fontSize: '40px', fontWeight: 700, lineHeight: 1.1, fontFamily: headingFont(theme), color: colorValue(styles.color, theme) ?? theme.colors?.primary ?? '#2E6BE6' }}>
                  {text(stat.value)}
                </p>
                <p style={{ margin: '6px 0 0', fontSize: '14px', color: theme.colors?.muted ?? '#6B7280' }}>{text(stat.label)}</p>
              </div>
            ))}
          </Grid>
        </div>
      );

    case 'team':
      return (
        <div style={{ ...styleFor(styles, theme) }}>
          {text(p.title) && <h2 style={{ margin: '0 0 22px', fontSize: '27px', fontFamily: headingFont(theme) }}>{text(p.title)}</h2>}
          <Grid columns={p.columns} gap="22px">
            {items(p.members).map((member, index) => (
              <div key={index} style={{ textAlign: 'center' }}>
                {imageSrc(member.image) ? (
                  <Figure src={imageSrc(member.image)} alt={text(member.name)} ratio="1/1" circle />
                ) : (
                  <div
                    style={{
                      width: '96px',
                      height: '96px',
                      margin: '0 auto',
                      borderRadius: '50%',
                      background: theme.colors?.background ?? '#F7F8FA',
                      border: `1px solid ${theme.colors?.border ?? '#E5E7EB'}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '26px',
                      fontWeight: 600,
                      color: theme.colors?.muted ?? '#6B7280',
                    }}
                  >
                    {(text(member.name) || '?').slice(0, 1).toUpperCase()}
                  </div>
                )}
                <p style={{ margin: '14px 0 2px', fontWeight: 600 }}>{text(member.name)}</p>
                <p style={{ margin: 0, fontSize: '13px', color: theme.colors?.primary ?? '#2E6BE6' }}>{text(member.role)}</p>
                {text(member.bio) && <p style={{ margin: '8px 0 0', fontSize: '13.5px', lineHeight: 1.55, color: theme.colors?.muted ?? '#6B7280' }}>{text(member.bio)}</p>}
              </div>
            ))}
          </Grid>
        </div>
      );

    case 'testimonials':
      return (
        <div style={{ ...styleFor(styles, theme) }}>
          {text(p.title) && <h2 style={{ margin: '0 0 22px', fontSize: '27px', fontFamily: headingFont(theme) }}>{text(p.title)}</h2>}
          <Grid columns={p.columns} gap="18px">
            {items(p.items).map((entry, index) => (
              <figure
                key={index}
                style={{
                  margin: 0,
                  padding: '22px',
                  borderRadius: theme.radius ?? '12px',
                  border: `1px solid ${theme.colors?.border ?? '#E5E7EB'}`,
                  background: theme.colors?.surface ?? '#FFFFFF',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                <Stars count={num(entry.rating, 0)} />
                <blockquote style={{ margin: 0, fontSize: '15.5px', lineHeight: 1.6 }}>{text(entry.quote)}</blockquote>
                <figcaption style={{ marginTop: 'auto', fontSize: '13.5px' }}>
                  <strong>{text(entry.author)}</strong>
                  {text(entry.role) && <span style={{ color: theme.colors?.muted ?? '#6B7280' }}> · {text(entry.role)}</span>}
                </figcaption>
              </figure>
            ))}
          </Grid>
        </div>
      );

    case 'cta_banner': {
      const background = colorValue(p.background, theme) ?? theme.colors?.primary ?? '#2E6BE6';
      return (
        <div
          style={{
            padding: '40px 32px',
            borderRadius: theme.radius ?? '14px',
            background,
            color: theme.colors?.surface ?? '#FFFFFF',
            textAlign: styles.align ?? 'center',
            ...styleFor({ ...styles, background: undefined }, theme),
          }}
        >
          <h2 style={{ margin: 0, fontSize: '28px', fontFamily: headingFont(theme), color: 'inherit' }}>{text(p.title)}</h2>
          {text(p.body) && <p style={{ margin: '12px auto 0', maxWidth: '60ch', opacity: 0.92 }}>{text(p.body)}</p>}
          {(text(p.button_label) || text(p.button_href)) && (
            <div style={{ marginTop: '22px' }}>
              <ButtonLink label={text(p.button_label)} href={siteHref(p.button_href, ctx)} variant="secondary" theme={theme} />
            </div>
          )}
        </div>
      );
    }

    case 'navbar': {
      const links = items(p.links);
      const base = ctx.basePath;
      return (
        <header
          style={{
            position: flag(p.sticky) ? 'sticky' : 'relative',
            top: 0,
            zIndex: 20,
            background: colorValue(styles.background, theme) ?? theme.colors?.surface ?? '#FFFFFF',
            color: colorValue(styles.color, theme) ?? theme.colors?.text ?? '#111827',
            borderBottom: `1px solid ${theme.colors?.border ?? '#E5E7EB'}`,
            ...styleFor({ ...styles, align: undefined, width: undefined }, theme),
          }}
        >
          <div
            style={{
              maxWidth: theme.max_width ?? '1200px',
              margin: '0 auto',
              padding: '12px 20px',
              display: 'flex',
              alignItems: 'center',
              gap: '22px',
              flexWrap: 'wrap',
            }}
          >
            <a href={base} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 700, fontSize: '17px', textDecoration: 'none', color: 'inherit' }}>
              {imageSrc(p.logo) && <img src={imageSrc(p.logo)} alt="" style={{ height: '28px', width: 'auto' }} />}
              {text(p.brand) || 'Your site'}
            </a>
            <nav style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', marginLeft: 'auto', fontSize: '14.5px' }}>
              {links.map((link, index) => {
                const href = siteHref(link.href, ctx);
                return href ? (
                  <a key={index} href={href} style={{ color: 'inherit', textDecoration: 'none', fontWeight: 500 }}>
                    {text(link.label)}
                  </a>
                ) : (
                  <span key={index} style={{ color: 'inherit', opacity: 0.5, fontWeight: 500 }}>
                    {text(link.label) || 'Link'}
                  </span>
                );
              })}
            </nav>
            {(text(p.button_label) || text(p.button_href)) && (
              <ButtonLink label={text(p.button_label)} href={siteHref(p.button_href, ctx)} theme={theme} size="sm" />
            )}
          </div>
        </header>
      );
    }

    case 'footer': {
      const links = items(p.links);
      return (
        <footer
          style={{
            background: colorValue(styles.background, theme) ?? '#111827',
            color: colorValue(styles.color, theme) ?? '#E5E7EB',
            ...styleFor({ ...styles, align: undefined, width: undefined }, theme),
          }}
        >
          <div style={{ maxWidth: theme.max_width ?? '1200px', margin: '0 auto', padding: '44px 20px 26px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '28px', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ maxWidth: '380px' }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: '16px', color: 'inherit' }}>{text(p.brand) || 'Your site'}</p>
                {text(p.blurb) && <p style={{ margin: '10px 0 0', fontSize: '14px', lineHeight: 1.6, opacity: 0.8 }}>{text(p.blurb)}</p>}
              </div>
              {links.length > 0 && (
                <nav style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '14px' }}>
                  {links.map((link, index) => {
                    const href = siteHref(link.href, ctx);
                    return href ? (
                      <a key={index} href={href} style={{ color: 'inherit', textDecoration: 'none', opacity: 0.85 }}>
                        {text(link.label)}
                      </a>
                    ) : (
                      <span key={index} style={{ opacity: 0.5 }}>{text(link.label)}</span>
                    );
                  })}
                </nav>
              )}
            </div>
            <p style={{ margin: '30px 0 0', paddingTop: '18px', borderTop: '1px solid rgba(255,255,255,.12)', fontSize: '13px', opacity: 0.7 }}>
              {text(p.copyright) || `© ${new Date().getFullYear()} ${text(p.brand) || 'Your site'}`}
            </p>
          </div>
        </footer>
      );
    }

    case 'social_links':
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', ...styleFor(styles, theme) }}>
          {items(p.items).map((entry, index) => {
            const network = text(entry.network);
            const href = safeHref(entry.href);
            const glyph = SOCIAL[network];
            const body = (
              <>
                {glyph ? <SocialGlyph network={network} /> : null}
                <span>{glyph?.label ?? network ?? 'Link'}</span>
              </>
            );
            return href ? (
              <a
                key={index}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '7px 12px', borderRadius: '999px', border: `1px solid ${theme.colors?.border ?? '#E5E7EB'}`, fontSize: '13.5px', textDecoration: 'none', color: 'inherit' }}
              >
                {body}
              </a>
            ) : (
              <span key={index} style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '7px 12px', borderRadius: '999px', border: `1px dashed ${theme.colors?.border ?? '#E5E7EB'}`, fontSize: '13.5px', opacity: 0.6 }}>
                {body}
              </span>
            );
          })}
        </div>
      );

    case 'contact_details': {
      const rows: { label: string; value: string; href?: string }[] = [];
      if (text(p.address)) rows.push({ label: 'Address', value: text(p.address) });
      if (text(p.phone)) rows.push({ label: 'Phone', value: text(p.phone), href: `tel:${text(p.phone).replace(/[^\d+]/g, '')}` });
      if (text(p.email)) rows.push({ label: 'Email', value: text(p.email), href: `mailto:${text(p.email)}` });
      if (text(p.hours)) rows.push({ label: 'Hours', value: text(p.hours) });
      return (
        <div style={{ ...styleFor(styles, theme) }}>
          {text(p.title) && <h3 style={{ margin: '0 0 12px', fontSize: '20px', fontFamily: headingFont(theme) }}>{text(p.title)}</h3>}
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 18px', fontSize: '14.5px' }}>
            {rows.map((row, index) => (
              <div key={index} style={{ display: 'contents' }}>
                <dt style={{ color: theme.colors?.muted ?? '#6B7280', fontWeight: 500 }}>{row.label}</dt>
                <dd style={{ margin: 0, whiteSpace: 'pre-line' }}>
                  {row.href ? (
                    <a href={row.href} style={{ color: theme.colors?.primary ?? '#2E6BE6' }}>
                      {row.value}
                    </a>
                  ) : (
                    row.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      );
    }

    case 'map': {
      const query = text(p.query).trim();
      if (!query) return <EmptyNote label="Type a place or address to load the map." />;
      return (
        <div style={{ ...styleFor(styles, theme) }}>
          <div style={{ borderRadius: theme.radius ?? '10px', overflow: 'hidden', border: `1px solid ${theme.colors?.border ?? '#E5E7EB'}` }}>
            <iframe
              title={query}
              src={mapFrame(query, num(p.zoom, 14))}
              loading="lazy"
              referrerPolicy="no-referrer"
              style={{ display: 'block', width: '100%', height: `${num(p.height, 320)}px`, border: 0 }}
            />
          </div>
        </div>
      );
    }

    case 'newsletter_form': {
      const form = ctx.forms[text(p.form_id)] ?? undefined;
      // Without a form to write into there is nowhere for the address to go, so
      // the block says so instead of rendering a subscribe button that 404s.
      if (!form) {
        return <EmptyNote label={ctx.mode === 'canvas' ? 'Choose which form saves these sign-ups, on the right.' : 'Sign-ups are not open on this page yet.'} />;
      }
      // The form posts without JavaScript, and the server sends the browser back to
      // this page with the outcome in the address. Each block keys that address by
      // its own id so two sign-ups on one page cannot light up each other's reply.
      const reply = `yourbiss-${node.id}`;
      return (
        <div style={{ ...styleFor(styles, theme) }}>
          {text(p.title) && <h3 style={{ margin: '0 0 10px', fontSize: '20px', fontFamily: headingFont(theme) }}>{text(p.title)}</h3>}
          <form method="post" action="/api/newsletter" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', maxWidth: '480px' }}>
            <input type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px' }} />
            <input type="hidden" name="form" value={form.id} />
            <input type="hidden" name="ret" value={node.id} />
            <label style={{ flex: 1, minWidth: '220px' }}>
              <span className="sr-only">Email address</span>
              <input
                type="email"
                name="email"
                required
                autoComplete="email"
                placeholder={text(p.placeholder) || 'you@company.com'}
                style={{ width: '100%', padding: '11px 14px', borderRadius: theme.radius ?? '8px', border: `1px solid ${theme.colors?.border ?? '#E5E7EB'}`, fontSize: '15px', color: theme.colors?.text ?? '#111827' }}
              />
            </label>
            <button
              type="submit"
              style={{ ...buttonPrimary(theme), padding: '11px 20px', borderRadius: theme.radius ?? '8px', fontWeight: 600, cursor: 'pointer', border: '1px solid transparent', fontSize: '15px' }}
            >
              {text(p.button_label) || 'Subscribe'}
            </button>
          </form>
          {ctx.mode === 'live' && (
            <div aria-live="polite">
              <p id={`${reply}-subscribed`} className="yb-target-only" style={replyStyle(theme)}>
                {text(p.success) || 'Thanks — your address is on the list.'}
              </p>
              <p id={`${reply}-duplicate`} className="yb-target-only" style={replyStyle(theme)}>
                That address is already on the list.
              </p>
              <p id={`${reply}-error`} className="yb-target-only" style={replyStyle(theme)}>
                That address could not be recorded. Please try again.
              </p>
            </div>
          )}
        </div>
      );
    }

    case 'form_embed': {
      const form = ctx.forms[text(p.form_id)];
      if (!form) {
        return <EmptyNote label={ctx.mode === 'canvas' ? 'Choose which form to show, on the right.' : 'This form is not available.'} />;
      }
      if (ctx.mode === 'canvas') {
        return <EmptyNote label={`Form · ${form.label}`} />;
      }
      return (
        <div style={{ ...styleFor(styles, theme) }}>
          {/* Whichever side shows the form's own title, the frame is told to leave
              it out — the heading appears once, wherever the toggle puts it. */}
          {flag(p.show_title) && <h3 style={{ margin: '0 0 14px', fontSize: '20px', fontFamily: headingFont(theme) }}>{form.label}</h3>}
          <iframe
            title={form.label}
            src={`/embed/form/${form.id}${flag(p.show_title) ? '?title=off' : ''}`}
            loading="lazy"
            style={{ display: 'block', width: '100%', height: `${num(p.height, 620)}px`, border: `1px solid ${theme.colors?.border ?? '#E5E7EB'}`, borderRadius: theme.radius ?? '10px', background: theme.colors?.surface ?? '#FFFFFF' }}
          />
        </div>
      );
    }

    case 'booking_embed': {
      const service = ctx.services[text(p.service_id)];
      const staff = ctx.staff[text(p.staff_id)];
      if (!service) {
        return <EmptyNote label={ctx.mode === 'canvas' ? 'Choose which service customers book, on the right.' : 'Booking unavailable.'} />;
      }
      if (ctx.mode === 'canvas') {
        return <EmptyNote label={`Booking · ${service.label}${staff ? ` (${staff.label})` : ''}`} />;
      }
      const src = `/embed/book/${service.id}${staff ? `?staff=${encodeURIComponent(staff.id)}` : ''}`;
      return (
        <div style={{ ...styleFor(styles, theme) }}>
          <iframe
            title={`Book ${service.label}`}
            src={src}
            loading="lazy"
            style={{ display: 'block', width: '100%', height: `${num(p.height, 720)}px`, border: `1px solid ${theme.colors?.border ?? '#E5E7EB'}`, borderRadius: theme.radius ?? '10px', background: theme.colors?.surface ?? '#FFFFFF' }}
          />
        </div>
      );
    }

    case 'product_grid': {
      const fromInventory = p.source === 'inventory';
      const shown: RenderProduct[] = fromInventory
        ? ctx.products
        : items(p.products).map((product, index) => ({
            id: String(index),
            name: text(product.name),
            price: text(product.price),
            body: text(product.body),
            image: text(product.image),
          }));

      return (
        <div style={{ ...styleFor(styles, theme) }}>
          {text(p.title) && <h2 style={{ margin: '0 0 20px', fontSize: '27px', fontFamily: headingFont(theme) }}>{text(p.title)}</h2>}
          {shown.length === 0 ? (
            <EmptyNote
              label={
                fromInventory
                  ? 'Nothing on the Inventory list is for sale yet. Add an active product there, or switch this block to typed products.'
                  : 'Add a product on the right, or point this block at the Inventory app.'
              }
            />
          ) : (
            <Grid columns={p.columns} gap="18px">
              {shown.map((product) => (
                <article
                  key={product.id}
                  style={{ border: `1px solid ${theme.colors?.border ?? '#E5E7EB'}`, borderRadius: theme.radius ?? '10px', overflow: 'hidden', background: theme.colors?.surface ?? '#FFFFFF' }}
                >
                  {imageSrc(product.image) && <Figure src={imageSrc(product.image)} alt={product.name} ratio="4/3" radius="0px" />}
                  <div style={{ padding: '16px' }}>
                    <p style={{ margin: 0, fontWeight: 600 }}>{product.name}</p>
                    {product.body && <p style={{ margin: '6px 0 0', fontSize: '13.5px', color: theme.colors?.muted ?? '#6B7280' }}>{product.body}</p>}
                    <p style={{ margin: '10px 0 0', fontWeight: 700, color: theme.colors?.primary ?? '#2E6BE6' }}>{product.price}</p>
                  </div>
                </article>
              ))}
            </Grid>
          )}
        </div>
      );
    }

    default:
      return null;
  }
}

/** Box model for the three container blocks; walkers add the children. */
export function containerStyle(node: BlockNode, ctx: RenderContext): { outer: CSSProperties; inner: CSSProperties } {
  const theme = ctx.theme;
  const styles = propStyles(node);

  if (node.type === 'section') {
    return {
      outer: { ...sectionTone(node.props?.tone, theme), ...styleFor({ ...styles, align: undefined, background: undefined }, theme), width: '100%' },
      inner: {
        maxWidth: styles.width === 'full' ? '100%' : theme.max_width ?? '1200px',
        margin: '0 auto',
        paddingInline: styles.width === 'full' ? '20px' : '24px',
      },
    };
  }

  if (node.type === 'columns') {
    const count = Math.max(2, Math.min(4, num(node.props?.count, 2)));
    // "Stack vertically" needs no media query: each track asks for a real width,
    // so the grid loses columns as the page narrows and reaches one on a phone.
    // "Keep side by side" pins the count instead, which is the point of it.
    const content = Number.parseInt(String(theme.max_width ?? '1200px'), 10) || 1200;
    const tracks =
      text(node.props?.stack_on_mobile) === 'scroll'
        ? `repeat(${count}, minmax(0, 1fr))`
        : `repeat(auto-fit, minmax(min(100%, ${Math.floor((content - 60) / count)}px), 1fr))`;
    return {
      outer: {
        display: 'grid',
        gridTemplateColumns: tracks,
        gap: styleFor(styles, theme).gap ?? '24px',
        ...styleFor({ ...styles, gap: undefined }, theme),
      },
      inner: { display: 'contents' },
    };
  }

  return {
    outer: { ...styleFor(styles, theme, { maxWidth: theme.max_width }) },
    inner: { display: 'contents' },
  };
}

/** What the outline list and drag previews show as a block's name. */
export function blockLabel(node: BlockNode): string {
  const primary =
    text(node.props?.text) ||
    text(node.props?.title) ||
    text(node.props?.label) ||
    text(node.props?.name) ||
    text(node.props?.question) ||
    richTextToPlain(node.props?.html);
  const fallback = REGISTRY[node.type]?.label ?? node.type.replace(/_/g, ' ');
  return primary ? `${fallback}: ${primary.slice(0, 42)}` : fallback;
}
