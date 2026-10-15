'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw } from 'lucide-react';
import { DEFAULT_THEME, normalizeTheme } from '@/lib/blocks/style';
import type { SiteTheme } from '@/lib/types';
import { updateTheme } from '@/lib/actions/sites';
import { Button, Field, Input, Select, toast } from '@/components/ui';
import { cn } from '@/lib/utils';

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const COLOUR_FIELDS: { key: keyof SiteTheme['colors']; label: string; hint: string }[] = [
  { key: 'primary', label: 'Brand colour', hint: 'Buttons, links and accents' },
  { key: 'background', label: 'Page background', hint: 'Behind every section' },
  { key: 'surface', label: 'Panel background', hint: 'Cards, inputs and reversed text' },
  { key: 'text', label: 'Text', hint: 'Headings and paragraphs' },
  { key: 'muted', label: 'Secondary text', hint: 'Captions and meta lines' },
  { key: 'border', label: 'Lines', hint: 'Dividers and outlines' },
];

/**
 * Single words only, because the renderer writes the family into `font-family`
 * unquoted — `Times New Roman` would need quotes to be valid CSS. Every choice
 * here is a name a browser can resolve from the visitor's own machine, so a site
 * never pulls a font file from a third party.
 */
const FONTS: { value: string; label: string }[] = [
  { value: 'Inter', label: 'Inter — falls back to the system sans' },
  { value: 'system-ui', label: 'System sans' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Helvetica', label: 'Helvetica' },
  { value: 'Verdana', label: 'Verdana' },
  { value: 'Tahoma', label: 'Tahoma' },
  { value: 'Trebuchet', label: 'Trebuchet' },
  { value: 'Georgia', label: 'Georgia — serif' },
  { value: 'Times', label: 'Times — serif' },
  { value: 'Courier', label: 'Courier — mono' },
];

const RADII = ['0px', '4px', '10px', '16px', '24px', '999px'];
const WIDTHS = ['960px', '1100px', '1200px', '1320px', '1440px', '100%'];
const GAPS = ['24px', '32px', '48px', '64px', '80px'];

const PRESETS: { name: string; theme: SiteTheme }[] = [
  {
    name: 'Default blue',
    theme: DEFAULT_THEME,
  },
  {
    name: 'Warm ink',
    theme: {
      colors: { primary: '#B45309', surface: '#FFFDF8', background: '#FAF6EF', text: '#26211A', muted: '#6F665A', border: '#E7DED0' },
      fonts: { heading: 'Georgia', body: 'Georgia' },
      radius: '4px',
      max_width: '1100px',
      section_gap: '56px',
    },
  },
  {
    name: 'Dark slate',
    theme: {
      colors: { primary: '#60A5FA', surface: '#111827', background: '#0B1020', text: '#E5E7EB', muted: '#94A3B8', border: '#1F2937' },
      fonts: { heading: 'Inter', body: 'Inter' },
      radius: '16px',
      max_width: '1200px',
      section_gap: '64px',
    },
  },
];

export function ThemeTab({ siteId, theme }: { siteId: string; theme: SiteTheme }) {
  const router = useRouter();
  const [saved, setSaved] = useState(() => normalizeTheme(theme));
  const [draft, setDraft] = useState(() => normalizeTheme(theme));
  const [pending, startTransition] = useTransition();

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const setColour = (key: keyof SiteTheme['colors'], value: string) =>
    setDraft((current) => ({ ...current, colors: { ...current.colors, [key]: value } }));

  const save = () => {
    startTransition(async () => {
      const result = await updateTheme(siteId, draft).catch((error: unknown) => ({
        ok: false as const,
        error: error instanceof Error ? error.message : 'The theme could not be saved',
      }));
      if (!result.ok) {
        toast.error(result.error ?? 'The theme could not be saved');
        return;
      }
      setSaved(draft);
      toast.success('Theme saved');
      router.refresh();
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid gap-4">
        <section className="ui-card">
          <header className="border-b border-line px-4 py-3">
            <p className="text-[13.5px] font-semibold text-ink">Colours</p>
            <p className="text-[12px] text-muted">Six names the whole site draws with. Any block can still override its own.</p>
          </header>
          <div className="grid gap-3 px-4 py-4 sm:grid-cols-2">
            {COLOUR_FIELDS.map((field) => (
              <ColourRow
                key={field.key}
                label={field.label}
                hint={field.hint}
                value={draft.colors[field.key]}
                disabled={pending}
                onChange={(next) => setColour(field.key, next)}
              />
            ))}
          </div>
        </section>

        <section className="ui-card">
          <header className="border-b border-line px-4 py-3">
            <p className="text-[13.5px] font-semibold text-ink">Type and shape</p>
            <p className="text-[12px] text-muted">
              Fonts are names the visitor already has, so nothing is downloaded from another company.
            </p>
          </header>
          <div className="grid gap-3 px-4 py-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Heading font" htmlFor="font-heading">
              <Select
                id="font-heading"
                value={draft.fonts.heading}
                disabled={pending}
                onChange={(event) => setDraft((c) => ({ ...c, fonts: { ...c.fonts, heading: event.target.value } }))}
              >
                {FONTS.map((font) => (
                  <option key={font.value} value={font.value}>
                    {font.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Body font" htmlFor="font-body">
              <Select
                id="font-body"
                value={draft.fonts.body}
                disabled={pending}
                onChange={(event) => setDraft((c) => ({ ...c, fonts: { ...c.fonts, body: event.target.value } }))}
              >
                {FONTS.map((font) => (
                  <option key={font.value} value={font.value}>
                    {font.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Corner radius" htmlFor="theme-radius" hint="Corners on cards, buttons and inputs">
              <Select
                id="theme-radius"
                value={draft.radius}
                disabled={pending}
                onChange={(event) => setDraft((c) => ({ ...c, radius: event.target.value }))}
              >
                {RADII.map((value) => (
                  <option key={value} value={value}>
                    {value === '999px' ? 'Pill' : value}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Content width" htmlFor="theme-max" hint="How wide a line of content can get">
              <Select
                id="theme-max"
                value={draft.max_width}
                disabled={pending}
                onChange={(event) => setDraft((c) => ({ ...c, max_width: event.target.value }))}
              >
                {WIDTHS.map((value) => (
                  <option key={value} value={value}>
                    {value === '100%' ? 'Edge to edge' : value}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Space between sections" htmlFor="theme-gap">
              <Select
                id="theme-gap"
                value={draft.section_gap}
                disabled={pending}
                onChange={(event) => setDraft((c) => ({ ...c, section_gap: event.target.value }))}
              >
                {GAPS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </section>

        <section className="ui-card">
          <header className="border-b border-line px-4 py-3">
            <p className="text-[13.5px] font-semibold text-ink">Start from a palette</p>
            <p className="text-[12px] text-muted">Fills the fields below it — you can still change any one of them.</p>
          </header>
          <div className="flex flex-wrap gap-2 px-4 py-4">
            {PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                disabled={pending}
                onClick={() => setDraft(normalizeTheme(preset.theme))}
                className="flex items-center gap-2 rounded-md border border-line-strong bg-surface px-2.5 py-2 text-[12.5px] font-medium text-ink transition-colors hover:border-brand disabled:opacity-50"
              >
                <span className="flex gap-1" aria-hidden="true">
                  {[preset.theme.colors.primary, preset.theme.colors.background, preset.theme.colors.text].map((c) => (
                    <span key={c} className="h-4 w-4 rounded-full border border-black/10" style={{ background: c }} />
                  ))}
                </span>
                {preset.name}
              </button>
            ))}
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDraft(normalizeTheme(DEFAULT_THEME))}>
              <RotateCcw size={13} />
              Reset to default
            </Button>
          </div>
        </section>
      </div>

      <div className="grid content-start gap-4">
        <section className="ui-card lg:sticky lg:top-4">
          <header className="border-b border-line px-4 py-3">
            <p className="text-[13.5px] font-semibold text-ink">Preview</p>
            <p className="text-[12px] text-muted">A section drawn with these colours.</p>
          </header>
          <div
            className="px-4 py-5"
            style={{
              background: draft.colors.background,
              color: draft.colors.text,
              fontFamily: `${draft.fonts.body}, ui-sans-serif, system-ui, sans-serif`,
            }}
          >
            <p
              style={{
                margin: 0,
                fontFamily: `${draft.fonts.heading}, ui-sans-serif, system-ui, sans-serif`,
                fontSize: '19px',
                fontWeight: 650,
              }}
            >
              Book a check-up
            </p>
            <p style={{ margin: '6px 0 0', fontSize: '13px', color: draft.colors.muted }}>
              Pick a time that suits you. Confirmation goes out the moment the slot is yours.
            </p>
            <div
              style={{
                marginTop: '14px',
                background: draft.colors.surface,
                border: `1px solid ${draft.colors.border}`,
                borderRadius: draft.radius === '999px' ? '999px' : draft.radius,
                padding: '12px 14px',
              }}
            >
              <p style={{ margin: 0, fontSize: '13px', fontWeight: 600 }}>Monday to Friday</p>
              <p style={{ margin: '2px 0 10px', fontSize: '12px', color: draft.colors.muted }}>09:00 — 17:00</p>
              <span
                style={{
                  display: 'inline-block',
                  background: draft.colors.primary,
                  color: draft.colors.surface,
                  fontSize: '12.5px',
                  fontWeight: 600,
                  padding: '7px 14px',
                  borderRadius: draft.radius === '999px' ? '999px' : draft.radius,
                }}
              >
                Choose a slot
              </span>
            </div>
          </div>
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-raised px-4 py-3">
            <p className="text-[12px] text-muted">{dirty ? 'Unsaved theme' : 'Saved'}</p>
            <div className="flex gap-2">
              {dirty && (
                <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDraft(saved)}>
                  Discard
                </Button>
              )}
              <Button variant="primary" size="sm" loading={pending} disabled={!dirty} onClick={save}>
                Save theme
              </Button>
            </div>
          </footer>
        </section>

        <p className="px-1 text-[12px] leading-relaxed text-muted">
          A theme belongs to the site, not to a page, so a saved theme changes the live site straight away. It is not
          rolled back when you restore an older version.
        </p>
      </div>
    </div>
  );
}

function ColourRow({
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  disabled: boolean;
  onChange: (hex: string) => void;
}) {
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(value);

  // A preset or a discard rewrites the value from above, so the box follows it.
  // Adjusting during render (rather than in an effect) avoids the extra pass.
  if (shown !== value) {
    setShown(value);
    setText(value);
  }

  const invalid = !HEX.test(text);
  const id = `colour-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  return (
    <Field label={label} htmlFor={id} hint={hint} error={invalid ? 'Use a hex colour like #2E6BE6' : undefined}>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'relative h-9 w-9 flex-none overflow-hidden rounded-md border',
            invalid ? 'border-danger' : 'border-line-strong',
          )}
          style={{ background: invalid ? '#ffffff' : text }}
        >
          <input
            type="color"
            aria-label={`${label} colour picker`}
            disabled={disabled}
            value={HEX.test(text) ? text : '#000000'}
            onChange={(event) => {
              setText(event.target.value);
              onChange(event.target.value);
            }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </span>
        <Input
          id={id}
          value={text}
          disabled={disabled}
          spellCheck={false}
          maxLength={7}
          invalid={invalid}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            if (HEX.test(next)) onChange(next);
          }}
        />
      </div>
    </Field>
  );
}
