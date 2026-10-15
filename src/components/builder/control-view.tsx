'use client';

import { useState } from 'react';
import { ImagePlus, Link2 } from 'lucide-react';
import type { Control } from '@/lib/blocks/controls';
import { Field, Input, Select, Switch, Textarea } from '@/components/ui';
import { cn } from '@/lib/utils';

export interface Option {
  id: string;
  label: string;
}

/** Server-supplied pick lists for the `entity` control, keyed by entity kind. */
export type EntityOptions = {
  forms: Option[];
  services: Option[];
  staff: Option[];
  pages: Option[];
};

export const EMPTY_OPTIONS: EntityOptions = { forms: [], services: [], staff: [], pages: [] };

const CONTROL_KINDS = ['text', 'textarea', 'richtext', 'number', 'select', 'toggle', 'color', 'image', 'link', 'entity'] as const;

export interface ControlViewProps {
  control: Control;
  value: unknown;
  onChange: (next: unknown) => void;
  options: EntityOptions;
  onPickImage?: (apply: (url: string) => void) => void;
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : String(value);
}

/**
 * One control descriptor, one input. Values are written straight into the block's
 * props; the server re-validates every one of them on save, so a field that
 * accepts a string here cannot become markup or a script on the published page.
 */
export function ControlView({ control, value, onChange, options, onPickImage }: ControlViewProps) {
  const id = `c-${control.key}-${CONTROL_KINDS.indexOf(control.kind)}`;

  switch (control.kind) {
    case 'text':
      return (
        <Field label={control.label} htmlFor={id} hint={control.max ? `${asText(value).length}/${control.max}` : undefined}>
          <Input
            id={id}
            value={asText(value)}
            maxLength={control.max ?? 400}
            placeholder={control.placeholder}
            onChange={(event) => onChange(event.target.value)}
          />
        </Field>
      );

    case 'textarea':
    case 'richtext':
      return (
        <Field
          label={control.label}
          htmlFor={id}
          hint={control.max ? `${asText(value).length}/${control.max}` : undefined}
        >
          <Textarea
            id={id}
            rows={control.kind === 'textarea' ? (control.rows ?? 4) : 6}
            maxLength={control.max ?? 4000}
            value={asText(value)}
            placeholder={control.kind === 'richtext' ? '**bold**, *italic*, [label](https://…), - list' : control.placeholder}
            onChange={(event) => onChange(event.target.value)}
          />
          {control.kind === 'richtext' && (
            <p className="mt-1 text-[11.5px] text-muted">
              Markdown-style formatting only. HTML is not accepted.
            </p>
          )}
        </Field>
      );

    case 'number':
      return (
        <Field label={control.label} htmlFor={id} hint={control.suffix}>
          <Input
            id={id}
            type="number"
            inputMode="numeric"
            min={control.min}
            max={control.max}
            step={control.step ?? 1}
            value={asText(value)}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10);
              onChange(Number.isFinite(parsed) ? parsed : event.target.value);
            }}
          />
        </Field>
      );

    case 'select':
      return (
        <Field label={control.label} htmlFor={id}>
          <Select id={id} value={asText(value)} onChange={(event) => onChange(event.target.value)}>
            {control.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      );

    case 'toggle':
      return (
        <div className="flex items-center justify-between gap-3 py-1">
          <span className="text-[12.5px] font-medium text-ink-soft">{control.label}</span>
          <Switch checked={value === true} onChange={onChange} label={control.label} id={id} />
        </div>
      );

    case 'color':
      return <ColorField id={id} label={control.label} value={asText(value)} onChange={onChange} />;

    case 'image':
      return (
        <Field label={control.label} htmlFor={id}>
          <div className="flex items-center gap-2">
            <Input
              id={id}
              value={asText(value)}
              placeholder="https://… or /image.jpg"
              onChange={(event) => onChange(event.target.value)}
            />
            <button
              type="button"
              onClick={() => onPickImage?.(onChange)}
              title="Choose from the media library"
              aria-label={`Choose an image for ${control.label}`}
              className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-md border border-line-strong bg-surface text-muted hover:border-brand hover:text-brand-dark"
            >
              <ImagePlus size={15} />
            </button>
          </div>
          {asText(value) && (
            <img
              src={asText(value)}
              alt=""
              className="mt-2 max-h-28 w-full rounded-md border border-line object-cover"
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
            />
          )}
        </Field>
      );

    case 'link':
      return <LinkField id={id} label={control.label} value={asText(value)} onChange={onChange} pages={options.pages} />;

    case 'entity': {
      const list = options[optionKey(control.entity)];
      const missing = list.length === 0;
      return (
        <Field
          label={control.label}
          htmlFor={id}
          hint={control.optional ? 'Optional' : undefined}
          error={
            missing && !control.optional
              ? `Nothing to show yet — create a ${entityNoun(control.entity)} first.`
              : undefined
          }
        >
          <Select
            id={id}
            value={asText(value)}
            disabled={missing}
            onChange={(event) => onChange(event.target.value)}
          >
            <option value="">{control.optional ? 'Not linked' : 'Choose…'}</option>
            {list.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      );
    }
  }
}

/** `form` is the entity name, `forms` is the pick list it is served from. */
function optionKey(entity: "form" | "booking_service" | "page" | "staff"): keyof EntityOptions {
  if (entity === "form") return "forms";
  if (entity === "booking_service") return "services";
  if (entity === "staff") return "staff";
  return "pages";
}

function entityNoun(entity: 'form' | 'booking_service' | 'page' | 'staff'): string {
  if (entity === 'form') return 'form';
  if (entity === 'booking_service') return 'booking service';
  if (entity === 'staff') return 'staff member';
  return 'page';
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function ColorField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const [custom, setCustom] = useState(value !== '' && !HEX.test(value));
  const swatch = HEX.test(value) ? value : '#ffffff';

  return (
    <Field label={label} htmlFor={id} error={value !== '' && !HEX.test(value) && custom ? 'Use a hex colour like #2E6BE6' : undefined}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} colour picker`}
          value={swatch}
          onChange={(event) => {
            setCustom(false);
            onChange(event.target.value.toUpperCase());
          }}
          className="h-9 w-9 flex-none cursor-pointer rounded-md border border-line-strong bg-surface p-1"
        />
        {custom ? (
          <Input
            id={id}
            value={value}
            placeholder="theme token or #2E6BE6"
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <Input
            id={id}
            value={value}
            placeholder="Theme default"
            onChange={(event) => {
              const next = event.target.value;
              if (next !== '' && !HEX.test(next)) setCustom(true);
              onChange(next);
            }}
          />
        )}
        <button
          type="button"
          onClick={() => {
            setCustom(false);
            onChange('');
          }}
          className="h-9 flex-none rounded-md border border-line-strong px-2 text-[12px] text-muted hover:text-ink"
          title="Use the theme value"
        >
          Theme
        </button>
      </div>
    </Field>
  );
}

/**
 * Links are typed against a scheme allowlist on the server (`/api` is not
 * enough — see `safeHref`), so this picker only has to make the common case,
 * "a page on this site", a click rather than a typed path.
 */
function LinkField({
  id,
  label,
  value,
  onChange,
  pages,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  pages: Option[];
}) {
  const [open, setOpen] = useState(false);
  const internal = pages.some((page) => page.id === value);

  return (
    <Field label={label} htmlFor={id}>
      <div className="flex items-center gap-2">
        <Input id={id} value={value} placeholder="https://…, /our-work or mailto:" onChange={(event) => onChange(event.target.value)} />
        {pages.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            title="Link to a page on this site"
            aria-label={`Choose a page for ${label}`}
            className={cn(
              'inline-flex h-9 w-9 flex-none items-center justify-center rounded-md border bg-surface',
              internal || open ? 'border-brand text-brand-dark' : 'border-line-strong text-muted hover:border-brand hover:text-brand-dark',
            )}
          >
            <Link2 size={15} />
          </button>
        )}
      </div>
      {open && pages.length > 0 && (
        <div className="mt-2 max-h-44 overflow-y-auto rounded-md border border-line bg-raised p-1">
          {pages.map((page) => (
            <button
              key={page.id}
              type="button"
              onClick={() => {
                onChange(page.id);
                setOpen(false);
              }}
              className={cn(
                'block w-full truncate rounded px-2 py-1.5 text-left text-[12.5px] hover:bg-surface',
                page.id === value ? 'bg-surface font-medium text-brand-dark' : 'text-ink-soft',
              )}
            >
              {page.label}
            </button>
          ))}
        </div>
      )}
    </Field>
  );
}
