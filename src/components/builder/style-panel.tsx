'use client';

import { useState } from 'react';
import type { BlockStyle } from '@/lib/blocks/types';
import type { BlockDefinition } from '@/lib/blocks/controls';
import { STYLE_CHOICES } from '@/lib/blocks/style';
import { Field, Input, Select } from '@/components/ui';

/**
 * The style panel. Every control here writes a token from a fixed scale
 * (`md`, `lg`, `narrow`…), never raw CSS — `styleFor` on the server is the only
 * thing that turns a token into a declaration, which is what lets a jsonb
 * document style a published page without ever letting it script one.
 */

const COLOUR_TOKENS = [
  { value: '', label: 'Theme default' },
  { value: 'primary', label: 'Brand' },
  { value: 'surface', label: 'Surface' },
  { value: 'background', label: 'Background' },
  { value: 'text', label: 'Text' },
  { value: 'muted', label: 'Muted text' },
  { value: 'border', label: 'Border' },
  { value: 'transparent', label: 'None (transparent)' },
];

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

type Choice = { value: string; label: string };

function ScaleField({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: string;
  choices: readonly Choice[];
  onChange: (next: string) => void;
}) {
  const id = `s-${label.replace(/[^a-z]/gi, '').toLowerCase()}`;
  return (
    <Field label={label} htmlFor={id}>
      <Select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function ColourField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const token = COLOUR_TOKENS.some((option) => option.value === value);
  const hex = HEX.test(value) ? value : '#2e6be6';

  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} colour picker`}
          value={hex}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="h-9 w-9 flex-none cursor-pointer rounded-md border border-line-strong bg-surface p-1"
        />
        <Select value={token ? value : '__hex'} onChange={(event) => onChange(event.target.value)} aria-label={label}>
          {COLOUR_TOKENS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
          <option value="__hex">Custom hex…</option>
        </Select>
      </div>
      {!token && value !== '' && (
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={`${label} hex value`}
          className="mt-1.5"
          placeholder="#2E6BE6"
        />
      )}
    </Field>
  );
}

export function StylePanel({
  def,
  styles,
  onChange,
}: {
  def: BlockDefinition;
  styles: BlockStyle;
  onChange: (patch: Partial<BlockStyle>) => void;
}) {
  const keys = def.styleKeys ?? [];
  const [opacityOpen, setOpacityOpen] = useState(false);
  const text = (value: string | number | undefined): string => (value === undefined ? '' : String(value));

  const clear = (key: keyof BlockStyle) => onChange({ [key]: undefined } as Partial<BlockStyle>);

  if (keys.length === 0) {
    return <p className="text-[12.5px] text-muted">This block takes its look from the theme and from the blocks inside it.</p>;
  }

  return (
    <div className="grid gap-3">
      {(keys.includes('align') || keys.includes('width')) && (
        <section className="grid gap-3 sm:grid-cols-2">
          {keys.includes('align') && (
            <ScaleField
              label="Alignment"
              value={styles.align ?? ''}
              choices={STYLE_CHOICES.align}
              onChange={(value) => (value === '' ? clear('align') : onChange({ align: value as BlockStyle['align'] }))}
            />
          )}
          {keys.includes('width') && (
            <ScaleField
              label="Width"
              value={styles.width ?? ''}
              choices={STYLE_CHOICES.width}
              onChange={(value) => (value === '' ? clear('width') : onChange({ width: value as BlockStyle['width'] }))}
            />
          )}
        </section>
      )}

      {(keys.includes('padding') || keys.includes('gap')) && (
        <section className="grid gap-3 sm:grid-cols-2">
          {keys.includes('padding') && (
            <>
              <ScaleField
                label="Vertical space"
                value={text(styles.padding_y)}
                choices={STYLE_CHOICES.space}
                onChange={(value) => (value === '' ? clear('padding_y') : onChange({ padding_y: value }))}
              />
              <ScaleField
                label="Horizontal space"
                value={text(styles.padding_x)}
                choices={STYLE_CHOICES.space}
                onChange={(value) => (value === '' ? clear('padding_x') : onChange({ padding_x: value }))}
              />
            </>
          )}
          {keys.includes('gap') && (
            <ScaleField
              label="Gap between items"
              value={text(styles.gap)}
              choices={STYLE_CHOICES.space}
              onChange={(value) => (value === '' ? clear('gap') : onChange({ gap: value }))}
            />
          )}
        </section>
      )}

      {keys.includes('font') && (
        <section className="grid gap-3 sm:grid-cols-2">
          <ScaleField
            label="Text size"
            value={text(styles.font_size)}
            choices={STYLE_CHOICES.fontSize}
            onChange={(value) => (value === '' ? clear('font_size') : onChange({ font_size: value }))}
          />
          <ScaleField
            label="Weight"
            value={text(styles.font_weight)}
            choices={STYLE_CHOICES.weight}
            onChange={(value) => (value === '' ? clear('font_weight') : onChange({ font_weight: value }))}
          />
          <ScaleField
            label="Line height"
            value={text(styles.line_height)}
            choices={STYLE_CHOICES.lineHeight}
            onChange={(value) => (value === '' ? clear('line_height') : onChange({ line_height: value }))}
          />
        </section>
      )}

      {(keys.includes('color') || keys.includes('background')) && (
        <section className="grid gap-3">
          {keys.includes('color') && (
            <ColourField label="Text colour" value={text(styles.color)} onChange={(value) => onChange({ color: value })} />
          )}
          {keys.includes('background') && (
            <ColourField label="Background" value={text(styles.background)} onChange={(value) => onChange({ background: value })} />
          )}
        </section>
      )}

      {(keys.includes('radius') || keys.includes('shadow')) && (
        <section className="grid gap-3 sm:grid-cols-2">
          {keys.includes('radius') && (
            <ScaleField
              label="Corner radius"
              value={text(styles.radius)}
              choices={STYLE_CHOICES.radius}
              onChange={(value) => (value === '' ? clear('radius') : onChange({ radius: value }))}
            />
          )}
          {keys.includes('shadow') && (
            <ScaleField
              label="Shadow"
              value={text(styles.shadow)}
              choices={STYLE_CHOICES.shadow}
              onChange={(value) => (value === '' ? clear('shadow') : onChange({ shadow: value as BlockStyle['shadow'] }))}
            />
          )}
          <ScaleField
            label="Border width"
            value={text(styles.border_width)}
            choices={STYLE_CHOICES.borderWidth}
            onChange={(value) => (value === '' ? clear('border_width') : onChange({ border_width: value }))}
          />
          <div className="sm:col-span-2">
            <ColourField label="Border colour" value={text(styles.border_color)} onChange={(value) => onChange({ border_color: value })} />
          </div>
        </section>
      )}

      <section>
        <button
          type="button"
          onClick={() => setOpacityOpen((current) => !current)}
          aria-expanded={opacityOpen}
          className="text-[12px] font-semibold uppercase tracking-wide text-muted hover:text-ink"
        >
          {opacityOpen ? 'Hide fine tuning' : 'Fine tuning'}
        </button>
        {opacityOpen && (
          <div className="mt-3 grid gap-1.5">
            <div className="flex items-center justify-between text-[12px] text-ink-soft">
              <label htmlFor="style-opacity">Opacity</label>
              <span className="tabular-nums text-muted">{Math.round((styles.opacity ?? 1) * 100)}%</span>
            </div>
            <input
              id="style-opacity"
              type="range"
              min={10}
              max={100}
              step={5}
              value={Math.round((styles.opacity ?? 1) * 100)}
              onChange={(event) => {
                const percent = Number.parseInt(event.target.value, 10);
                if (percent >= 100) clear('opacity');
                else onChange({ opacity: percent / 100 });
              }}
              className="w-full accent-[var(--color-brand)]"
            />
          </div>
        )}
      </section>
    </div>
  );
}
