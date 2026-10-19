'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Heart, Smile, Star, ThumbsUp } from 'lucide-react';
import { checkAnswers } from '@/lib/forms/answers';
import { orderedFields } from '@/lib/forms/definition';
import {
  answerCeiling,
  collectsMany,
  COMPOSITE_PART_MAX_CHARS,
  compositeParts,
  fieldIsRequired,
  fieldIsVisible,
  isComposite,
  isPresentational,
  partLabel,
  type FieldKind,
  type FieldOption,
  type FormFieldDef,
  type FormSettings,
  type FormTheme,
  type RatingSymbol,
} from '@/lib/forms/types';

/**
 * The form a visitor fills in — the shared link, the embed frame on a published
 * page, and nothing else.
 *
 * Validation runs twice on purpose: once here in the browser and once on the
 * server, both through the same `checkAnswers`, so the wording a visitor sees for
 * a bad phone number is the wording the server would have answered with. Field ids
 * are constrained by `formFieldSchema` to letters, numbers, dash and underscore, so
 * they are safe to use raw in a selector.
 */

export interface PublicFormProps {
  formId: string;
  title: string;
  description: string | null;
  fields: FormFieldDef[];
  settings: FormSettings;
  theme: FormTheme;
  /**
   * Today where the workspace keeps its clock, as `YYYY-MM-DD`, handed over by the
   * page. A "not in the past" rule judged by this browser's clock and by the server's
   * could disagree by a day, and the visitor would be told their answer is wrong
   * after it looked accepted.
   */
  today: string;
  /** `embed` leaves off the card: the frame already sits inside someone's page. */
  variant?: 'page' | 'embed';
}

type Answers = Record<string, unknown>;

interface SubmitResult {
  ok?: boolean;
  error?: string;
  fields?: Record<string, string>;
  message?: string;
  redirect?: string | null;
}

/** Choices a visitor never has to touch, because the form already knows them. */
function seedDefaults(fields: FormFieldDef[]): Answers {
  const seeded: Answers = {};
  for (const field of fields) {
    const value = field.default_value?.trim();
    if (!value || isPresentational(field.type)) continue;
    seeded[field.id] = collectsMany(field)
      ? value.split(',').map((v) => v.trim()).filter(Boolean)
      : value;
  }
  return seeded;
}

export function PublicForm({ formId, title, description, fields, settings, theme, today, variant = 'page' }: PublicFormProps) {
  const ordered = useMemo(() => orderedFields(fields, settings.field_order), [fields, settings.field_order]);
  const [answers, setAnswers] = useState<Answers>(() => seedDefaults(ordered));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [trapped, setTrapped] = useState('');
  const [finished, setFinished] = useState<string | null>(null);
  const ref = useRef<HTMLFormElement>(null);

  // A field its logic hides is not asked for, not validated, and not sent.
  const shown = useMemo(() => ordered.filter((field) => fieldIsVisible(field, answers, fields)), [ordered, answers, fields]);

  // A rule can make an otherwise optional question compulsory, and the asterisk has to
  // appear for exactly the same answers that make the submit check demand one.
  const requiredIds = useMemo(
    () => new Set(fields.filter((field) => fieldIsRequired(field, answers, fields)).map((field) => field.id)),
    [fields, answers],
  );

  const setValue = (id: string, value: unknown) => {
    setAnswers((previous) => ({ ...previous, [id]: value }));
    setErrors((previous) => {
      if (!(id in previous)) return previous;
      const next = { ...previous };
      delete next[id];
      return next;
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending) return;

    const payload: Answers = {};
    for (const field of shown) {
      if (!isPresentational(field.type)) payload[field.id] = answers[field.id] ?? '';
    }

    const check = checkAnswers(fields, settings.field_order, payload, today);
    if (Object.keys(check.errors).length > 0) {
      setErrors(check.errors);
      setNotice('Some answers need another look.');
      focusFirst(ref.current, check.errors);
      return;
    }

    setErrors({});
    setNotice(null);
    setSending(true);
    try {
      const response = await fetch('/api/form/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ form: formId, answers: payload, company: trapped, source: window.location.href }),
      });
      const result = (await response.json().catch(() => null)) as SubmitResult | null;

      if (response.ok) {
        if (result?.redirect) {
          window.location.assign(result.redirect);
          return;
        }
        setFinished(result?.message || settings.success_message);
      } else {
        setErrors(result?.fields ?? {});
        setNotice(result?.error ?? 'Your response could not be recorded. Please try again.');
        focusFirst(ref.current, result?.fields ?? {});
      }
    } catch {
      setNotice('Your connection dropped. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const done = (
    <div className="yb-form-done" role="status">
      <p className="yb-form-done-title">Thank you</p>
      <p>{finished}</p>
    </div>
  );

  if (finished !== null) {
    return (
      <div className="yb-form" style={themeVars(theme)}>
        {variant === 'page' ? <div className="yb-form-card">{done}</div> : done}
      </div>
    );
  }

  const body = (
    <>
      {(title !== '' || description) && <FormHead title={title} description={description} />}
      <form ref={ref} noValidate onSubmit={submit} className="yb-form-body">
        <Body
          shown={shown}
          answers={answers}
          requiredIds={requiredIds}
          errors={errors}
          setValue={setValue}
          settings={settings}
          sending={sending}
          notice={notice}
          trapped={trapped}
          setTrapped={setTrapped}
        />
      </form>
    </>
  );

  return (
    <div className="yb-form" style={themeVars(theme)}>
      {variant === 'page' ? <div className="yb-form-card">{body}</div> : body}
    </div>
  );
}

/** Put the caret on the first answer that failed. */
function focusFirst(form: HTMLFormElement | null, errors: Record<string, string>) {
  if (!form) return;
  const [first] = Object.keys(errors);
  if (!first) return;
  form.querySelector<HTMLElement>(`[data-control="${first}"]`)?.focus();
}

function FormHead({ title, description }: { title: string; description: string | null }) {
  return (
    <header className="yb-form-head">
      <h1 className="yb-form-title">{title}</h1>
      {description && <p className="yb-form-desc">{description}</p>}
    </header>
  );
}

function Body({
  shown,
  answers,
  requiredIds,
  errors,
  setValue,
  settings,
  sending,
  notice,
  trapped,
  setTrapped,
}: {
  shown: FormFieldDef[];
  answers: Answers;
  requiredIds: Set<string>;
  errors: Record<string, string>;
  setValue: (id: string, value: unknown) => void;
  settings: FormSettings;
  sending: boolean;
  notice: string | null;
  trapped: string;
  setTrapped: (value: string) => void;
}) {
  return (
    <>
      {/* Bots fill every text input they find; nobody else can see or reach this one. */}
      <input
        type="text"
        name="company"
        value={trapped}
        onChange={(event) => setTrapped(event.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="yb-form-trap"
      />

      {notice && (
        <p role="alert" className="yb-form-notice">
          {notice}
        </p>
      )}

      <div className="yb-form-grid">
        {shown.map((field) => (
          <FieldRow
            key={field.id}
            field={field}
            required={requiredIds.has(field.id)}
            value={answers[field.id]}
            error={errors[field.id]}
            setValue={setValue}
          />
        ))}
      </div>

      <div className="yb-form-foot">
        <button type="submit" className="yb-form-submit" disabled={sending}>
          {sending ? 'Sending…' : settings.submit_label || 'Submit'}
        </button>
      </div>
    </>
  );
}

/** Asked as a labelled list of options rather than a single box. */
const CHOICE_KINDS: FieldKind[] = ['radio', 'checkbox', 'multiselect', 'image_choice', 'yes_or_no'];

function FieldRow({
  field,
  required,
  value,
  error,
  setValue,
}: {
  field: FormFieldDef;
  required: boolean;
  value: unknown;
  error?: string;
  setValue: (id: string, value: unknown) => void;
}) {
  const half = field.width === 'half' ? ' yb-half' : '';

  if (field.type === 'divider') return <hr className={`yb-form-divider${half}`} />;
  if (field.type === 'spacer') return <div className={`yb-form-spacer${half}`} aria-hidden="true" />;

  if (field.type === 'section') {
    return (
      <section className={`yb-form-section${half}`}>
        <h2>{field.label}</h2>
        {field.help && <p className="yb-form-help">{field.help}</p>}
      </section>
    );
  }

  if (field.type === 'heading') {
    return (
      <p className={`yb-form-heading${half}`}>
        {field.label}
        {field.help && <span className="yb-form-help"> {field.help}</span>}
      </p>
    );
  }

  if (field.type === 'note') {
    return <p className={`yb-form-note${half}`}>{field.label}</p>;
  }

  const describedBy = [field.help ? `${field.id}-help` : null, error ? `${field.id}-error` : null].filter(Boolean).join(' ');

  if (CHOICE_KINDS.includes(field.type)) {
    return (
      <fieldset className={`yb-form-field yb-form-group${half}`} data-field={field.id}>
        <legend className="yb-form-label">
          {field.label}
          {required && <span className="yb-form-req">*</span>}
        </legend>
        <ChoiceList field={field} value={value} setValue={setValue} />
        {field.help && <p id={`${field.id}-help`} className="yb-form-help">{field.help}</p>}
        {error && (
          <p id={`${field.id}-error`} className="yb-form-error" role="alert">
            {error}
          </p>
        )}
      </fieldset>
    );
  }

  if (field.type === 'matrix') {
    return (
      <fieldset className={`yb-form-field yb-form-group${half}`} data-field={field.id}>
        <legend className="yb-form-label">
          {field.label}
          {required && <span className="yb-form-req">*</span>}
        </legend>
        <MatrixGrid field={field} value={value} error={!!error} setValue={setValue} />
        {field.help && <p id={`${field.id}-help`} className="yb-form-help">{field.help}</p>}
        {error && (
          <p id={`${field.id}-error`} className="yb-form-error" role="alert">
            {error}
          </p>
        )}
      </fieldset>
    );
  }

  if (isComposite(field.type)) {
    return (
      <fieldset className={`yb-form-field yb-form-group${half}`} data-field={field.id}>
        <legend className="yb-form-label">
          {field.label}
          {required && <span className="yb-form-req">*</span>}
        </legend>
        <PartsGrid field={field} required={required} value={value} error={!!error} setValue={setValue} describedBy={describedBy} />
        {field.help && <p id={`${field.id}-help`} className="yb-form-help">{field.help}</p>}
        {error && (
          <p id={`${field.id}-error`} className="yb-form-error" role="alert">
            {error}
          </p>
        )}
      </fieldset>
    );
  }

  return (
    <div className={`yb-form-field${half}`} data-field={field.id}>
      {field.type !== 'checkbox_single' && (
        <label className="yb-form-label" htmlFor={field.id}>
          {field.label}
          {required && <span className="yb-form-req">*</span>}
        </label>
      )}
      <Control field={field} required={required} value={value} error={!!error} setValue={setValue} describedBy={describedBy} />
      {field.help && <p id={`${field.id}-help`} className="yb-form-help">{field.help}</p>}
      {error && (
        <p id={`${field.id}-error`} className="yb-form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** `yes_or_no` carries its two answers in the type itself, not in an option list. */
function choicesOf(field: FormFieldDef): FieldOption[] {
  if (field.type === 'yes_or_no') return [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }];
  return field.options ?? [];
}

function ChoiceList({
  field,
  value,
  setValue,
}: {
  field: FormFieldDef;
  value: unknown;
  setValue: (id: string, value: unknown) => void;
}) {
  const chosen = Array.isArray(value) ? value.map(String) : value === undefined || value === '' ? [] : [String(value)];
  const multi = collectsMany(field);
  const options = choicesOf(field);
  const classes = ['yb-form-choices'];
  if (field.inline_choices) classes.push('yb-form-choices-inline');
  if (field.type === 'image_choice') classes.push('yb-form-choices-image');

  return (
    <div className={classes.join(' ')}>
      {options.map((option, index) => {
        const inputId = `${field.id}-${index}`;
        const picked = multi ? chosen.includes(String(option.value)) : chosen[0] === String(option.value);
        return (
          <label key={`${option.value}-${index}`} className="yb-form-choice" htmlFor={inputId}>
            <input
              id={inputId}
              type={multi ? 'checkbox' : 'radio'}
              name={field.id}
              value={option.value}
              checked={picked}
              data-control={field.id}
              onChange={() =>
                setValue(
                  field.id,
                  multi
                    ? picked
                      ? chosen.filter((x) => x !== String(option.value))
                      : [...chosen, String(option.value)]
                    : option.value,
                )
              }
            />
            {option.image_url ? (
              <span className="yb-form-image-choice">
                <img src={option.image_url} alt="" />
                <span>{option.label}</span>
              </span>
            ) : (
              <span>{option.label}</span>
            )}
          </label>
        );
      })}
    </div>
  );
}

function MatrixGrid({
  field,
  value,
  error,
  setValue,
}: {
  field: FormFieldDef;
  value: unknown;
  error: boolean;
  setValue: (id: string, value: unknown) => void;
}) {
  const chosen = (value && typeof value === 'object' ? value : {}) as Record<string, string>;
  const rows = field.matrix?.rows ?? [];
  const columns = field.matrix?.columns ?? [];

  return (
    <div className="yb-form-matrix" data-control={field.id} tabIndex={-1} aria-invalid={error || undefined}>
      <table>
        <thead>
          <tr>
            <th scope="col" className="yb-form-matrix-corner" aria-hidden="true" />
            {columns.map((column) => (
              <th key={String(column.value)} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.value)}>
              <th scope="row">{row.label}</th>
              {columns.map((column) => {
                const inputId = `${field.id}-${row.value}-${column.value}`;
                return (
                  <td key={String(column.value)}>
                    <input
                      id={inputId}
                      type="radio"
                      name={`${field.id}-${row.value}`}
                      checked={chosen[String(row.value)] === String(column.value)}
                      aria-label={`${row.label}: ${column.label}`}
                      onChange={() => setValue(field.id, { ...chosen, [String(row.value)]: String(column.value) })}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The tokens a browser keeps an address book under — a part typed once is filled for
 * every form that asks for it. The two sets share no key, so one map covers both. */
const AUTOFILL: Record<string, string> = {
  prefix: 'honorific-prefix',
  first: 'given-name',
  middle: 'additional-name',
  last: 'family-name',
  suffix: 'honorific-suffix',
  line1: 'street-address',
  line2: 'address-line2',
  city: 'address-level2',
  state: 'address-level1',
  zip: 'postal-code',
  country: 'country-name',
};

/** A street line is written long; a name part never is. */
const WIDE_PARTS = new Set(['line1', 'line2']);

/** A name is one answer with parts in it, so the boxes carry the part they hold and the
 * browser can fill the whole group from an address book. A required composite asks for
 * every part it shows — which is exactly what the builder says it does. */
function PartsGrid({
  field,
  required,
  value,
  error,
  setValue,
  describedBy,
}: {
  field: FormFieldDef;
  required: boolean;
  value: unknown;
  error: boolean;
  setValue: (id: string, value: unknown) => void;
  describedBy: string;
}) {
  const filled = (value && typeof value === 'object' ? value : {}) as Record<string, string>;

  return (
    <div className="yb-form-parts" data-control={field.id} tabIndex={-1} aria-invalid={error || undefined}>
      {compositeParts(field).map((part) => (
        <label key={part} className={`yb-form-part${WIDE_PARTS.has(part) ? ' yb-form-part-wide' : ''}`}>
          <span className="yb-form-part-label">{partLabel(field, part)}</span>
          <input
            id={`${field.id}-${part}`}
            type="text"
            autoComplete={AUTOFILL[part]}
            maxLength={COMPOSITE_PART_MAX_CHARS}
            aria-required={required || undefined}
            aria-describedby={describedBy || undefined}
            value={filled[part] ?? ''}
            onChange={(event) => setValue(field.id, { ...filled, [part]: event.target.value })}
          />
        </label>
      ))}
    </div>
  );
}

const RATING_GLYPH: Record<RatingSymbol, typeof Star | null> = {
  number: null,
  star: Star,
  heart: Heart,
  thumb: ThumbsUp,
  smiley: Smile,
};

/** One set of identity and a11y attributes, shared by every control for this field. */
function controlProps(field: FormFieldDef, required: boolean, error: boolean, describedBy: string) {
  return {
    id: field.id,
    name: field.id,
    'data-control': field.id,
    placeholder: field.placeholder ?? undefined,
    'aria-invalid': error || undefined,
    'aria-describedby': describedBy || undefined,
    'aria-required': required || undefined,
  };
}

function Control({
  field,
  required,
  value,
  error,
  setValue,
  describedBy,
}: {
  field: FormFieldDef;
  required: boolean;
  value: unknown;
  error: boolean;
  setValue: (id: string, value: unknown) => void;
  describedBy: string;
}) {
  const text = value === undefined || value === null || typeof value === 'object' ? '' : String(value);
  const v = field.validation ?? {};
  const shared = controlProps(field, required, error, describedBy);

  /** A code or a unit the answer cannot carry is drawn, never stored. */
  const withAffix = (input: React.ReactNode) =>
    field.prefix || field.suffix ? (
      <span className="yb-form-affix">
        {field.prefix && <span aria-hidden="true">{field.prefix}</span>}
        {input}
        {field.suffix && <span aria-hidden="true">{field.suffix}</span>}
      </span>
    ) : (
      input
    );

  switch (field.type) {
    case 'textarea':
      return withAffix(
        <textarea
          {...shared}
          rows={4}
          value={text}
          minLength={v.min_len}
          maxLength={answerCeiling(field)}
          onChange={(event) => setValue(field.id, event.target.value)}
        />,
      );

    case 'email':
      return withAffix(
        <input
          {...shared}
          type="email"
          autoComplete="email"
          inputMode="email"
          value={text}
          maxLength={answerCeiling(field)}
          onChange={(event) => setValue(field.id, event.target.value)}
        />,
      );

    case 'phone':
      return withAffix(
        <input
          {...shared}
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          value={text}
          maxLength={answerCeiling(field)}
          onChange={(event) => setValue(field.id, event.target.value)}
        />,
      );

    case 'url':
      return withAffix(
        <input
          {...shared}
          type="url"
          inputMode="url"
          placeholder={field.placeholder ?? 'https://'}
          value={text}
          maxLength={answerCeiling(field)}
          onChange={(event) => setValue(field.id, event.target.value)}
        />,
      );

    case 'number':
    case 'rupees':
    case 'currency': {
      const symbol =
        field.type === 'rupees' ? '₹' : field.type === 'currency' ? field.currency_symbol || '₹' : undefined;
      return withAffix(
        <span className="yb-form-money">
          {symbol && <span aria-hidden="true">{symbol}</span>}
          <input
            {...shared}
            type="number"
            inputMode="decimal"
            step="any"
            min={v.min}
            max={v.max}
            value={text}
            onChange={(event) => setValue(field.id, event.target.value)}
          />
        </span>,
      );
    }

    case 'date':
      return withAffix(
        <input {...shared} type="date" value={text} onChange={(event) => setValue(field.id, event.target.value)} />,
      );

    case 'datetime':
      return withAffix(
        <input {...shared} type="datetime-local" value={text} onChange={(event) => setValue(field.id, event.target.value)} />,
      );

    case 'monthyear':
      return withAffix(
        <input {...shared} type="month" value={text} onChange={(event) => setValue(field.id, event.target.value)} />,
      );

    case 'time':
      return withAffix(
        <input {...shared} type="time" value={text} onChange={(event) => setValue(field.id, event.target.value)} />,
      );

    case 'select':
      return withAffix(<SelectControl field={field} text={text} shared={shared} setValue={setValue} />);

    case 'checkbox_single':
      return (
        <label className="yb-form-choice yb-form-consent" htmlFor={field.id}>
          <input
            id={field.id}
            name={field.id}
            data-control={field.id}
            type="checkbox"
            checked={value === true}
            aria-invalid={error || undefined}
            aria-describedby={describedBy || undefined}
            aria-required={required || undefined}
            onChange={(event) => setValue(field.id, event.target.checked)}
          />
          <span>{field.label}</span>
        </label>
      );

    case 'rating': {
      const min = field.rating?.min ?? 1;
      const max = field.rating?.max ?? 5;
      const current = Number(value) || 0;
      const Glyph = RATING_GLYPH[field.rating?.symbol ?? 'star'];
      const scores: number[] = [];
      for (let score = min; score <= max; score += 1) scores.push(score);
      return (
        <div className="yb-form-rating" role="radiogroup" aria-label={field.label} data-control={field.id} tabIndex={0}>
          {scores.map((score) => (
            <button
              type="button"
              key={score}
              className={score <= current ? 'yb-form-star on' : 'yb-form-star'}
              role="radio"
              aria-checked={score === current}
              aria-label={`${score} of ${max}`}
              onClick={() => setValue(field.id, score)}
            >
              {Glyph ? <Glyph size={16} aria-hidden="true" /> : score}
            </button>
          ))}
        </div>
      );
    }

    case 'slider': {
      const min = v.min ?? 0;
      const max = v.max ?? 100;
      const step = field.slider?.step ?? 1;
      const current = value === undefined || value === '' ? min : Number(value);
      return (
        <span className="yb-form-slider">
          <input
            {...shared}
            type="range"
            min={min}
            max={max}
            step={step}
            value={Number.isFinite(current) ? current : min}
            onChange={(event) => setValue(field.id, event.target.value)}
          />
          {field.slider?.show_value !== false && (
            <output className="yb-form-slider-value" htmlFor={field.id}>
              {text || min}
              {field.suffix ? ` ${field.suffix}` : ''}
            </output>
          )}
        </span>
      );
    }

    case 'signature':
      return (
        <SignaturePad field={field} error={error} describedBy={describedBy} setValue={setValue} />
      );

    case 'geolocation':
      return <LocationControl field={field} value={value} error={error} describedBy={describedBy} setValue={setValue} />;

    case 'decision':
      return <DecisionControl field={field} value={value} setValue={setValue} />;

    default:
      return withAffix(
        <input
          {...shared}
          type="text"
          value={text}
          minLength={v.min_len}
          maxLength={answerCeiling(field)}
          pattern={v.pattern}
          onChange={(event) => setValue(field.id, event.target.value)}
        />,
      );
  }
}

/** A dropdown long enough to hunt through gets a filter box, and groups if the builder set them. */
function SelectControl({
  field,
  text,
  shared,
  setValue,
}: {
  field: FormFieldDef;
  text: string;
  shared: ReturnType<typeof controlProps>;
  setValue: (id: string, value: unknown) => void;
}) {
  const [filter, setFilter] = useState('');
  const options = field.options ?? [];
  const term = filter.trim().toLowerCase();
  const visible = term ? options.filter((o) => o.label.toLowerCase().includes(term)) : options;

  const grouped = visible.some((o) => o.group);
  const blocks: { group: string; options: typeof options }[] = [];
  for (const option of visible) {
    const group = option.group ?? '';
    const last = blocks[blocks.length - 1];
    if (last && last.group === group) last.options.push(option);
    else blocks.push({ group, options: [option] });
  }

  return (
    <>
      {field.searchable && (
        <input
          type="search"
          className="yb-form-filter"
          value={filter}
          aria-label={`Filter the options in ${field.label}`}
          placeholder="Type to narrow the list"
          onChange={(event) => setFilter(event.target.value)}
        />
      )}
      <select {...shared} value={text} onChange={(event) => setValue(field.id, event.target.value)}>
        <option value="">{field.placeholder || 'Choose one…'}</option>
        {grouped
          ? blocks.map((block, index) => (
              <optgroup key={`${block.group}-${index}`} label={block.group || '—'}>
                {block.options.map((option, optionIndex) => (
                  <option key={`${option.value}-${index}-${optionIndex}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))
          : visible.map((option, index) => (
              <option key={`${option.value}-${index}`} value={option.value}>
                {option.label}
              </option>
            ))}
      </select>
    </>
  );
}

/** The drawing is the answer, exported as a small PNG so a response row stays one value. */
function SignaturePad({
  field,
  error,
  describedBy,
  setValue,
}: {
  field: FormFieldDef;
  error: boolean;
  describedBy: string;
  setValue: (id: string, value: unknown) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pen = useRef<{ x: number; y: number } | null>(null);
  const [signed, setSigned] = useState(false);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ratio = window.devicePixelRatio || 1;
    el.width = Math.max(Math.round(el.clientWidth * ratio), 1);
    el.height = Math.round(140 * ratio);
    const ctx = el.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111827';
  }, []);

  const pointOf = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const stroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const start = pen.current;
    const ctx = event.currentTarget.getContext('2d');
    if (!start || !ctx) return;
    const next = pointOf(event);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
    pen.current = next;
  };

  const release = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pen.current) return;
    pen.current = null;
    setSigned(true);
    setValue(field.id, event.currentTarget.toDataURL('image/png'));
  };

  const clear = () => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.restore();
    setSigned(false);
    setValue(field.id, '');
  };

  return (
    <div className="yb-form-sign" data-control={field.id} tabIndex={-1} aria-invalid={error || undefined}>
      <canvas
        ref={canvas}
        className="yb-form-sign-pad"
        role="img"
        aria-label={`${field.label} — draw with a mouse, pen or finger`}
        aria-describedby={describedBy || undefined}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          pen.current = pointOf(event);
        }}
        onPointerMove={stroke}
        onPointerUp={release}
        onPointerCancel={release}
      />
      <div className="yb-form-sign-foot">
        <span className="yb-form-sign-state">{signed ? 'Signed' : 'Draw your signature here'}</span>
        {signed && (
          <button type="button" className="yb-form-sign-clear" onClick={clear}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Coordinates, captured by the browser or typed. Turning them into a street
 * address needs a geocoding service, so this stays a pair of numbers.
 */
function LocationControl({
  field,
  value,
  error,
  describedBy,
  setValue,
}: {
  field: FormFieldDef;
  value: unknown;
  error: boolean;
  describedBy: string;
  setValue: (id: string, value: unknown) => void;
}) {
  const parts = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const lat = typeof parts.lat === 'string' ? parts.lat : '';
  const lng = typeof parts.lng === 'string' ? parts.lng : '';
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const write = (next: Record<string, unknown>) =>
    setValue(field.id, { lat, lng, ...next });

  const locate = () => {
    if (!('geolocation' in navigator)) {
      setProblem('This browser will not share a location — type the coordinates instead.');
      return;
    }
    setBusy(true);
    setProblem(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setBusy(false);
        setValue(field.id, {
          lat: position.coords.latitude.toFixed(6),
          lng: position.coords.longitude.toFixed(6),
          accuracy: String(Math.round(position.coords.accuracy)),
        });
      },
      () => {
        setBusy(false);
        setProblem('The location was not shared — type the coordinates instead.');
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <div className="yb-form-geo" aria-describedby={describedBy || undefined} aria-invalid={error || undefined}>
      <div className="yb-form-geo-parts">
        <label className="yb-form-geo-part">
          <span>Latitude</span>
          <input
            id={`${field.id}-lat`}
            data-control={field.id}
            type="text"
            inputMode="decimal"
            value={lat}
            placeholder="-90 to 90"
            onChange={(event) => write({ lat: event.target.value })}
          />
        </label>
        <label className="yb-form-geo-part">
          <span>Longitude</span>
          <input
            id={field.id}
            name={field.id}
            type="text"
            inputMode="decimal"
            value={lng}
            placeholder="-180 to 180"
            onChange={(event) => write({ lng: event.target.value })}
          />
        </label>
      </div>
      <button type="button" className="yb-form-geo-locate" onClick={locate} disabled={busy}>
        {busy ? 'Finding…' : 'Use my location'}
      </button>
      {problem && (
        <p className="yb-form-error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

function DecisionControl({
  field,
  value,
  setValue,
}: {
  field: FormFieldDef;
  value: unknown;
  setValue: (id: string, value: unknown) => void;
}) {
  const parts = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const chosen = typeof parts.value === 'string' ? parts.value : '';
  const reason = typeof parts.reason === 'string' ? parts.reason : '';
  const approve = field.decision?.approve || 'Approve';
  const reject = field.decision?.reject || 'Reject';

  return (
    <div className="yb-form-decision" data-control={field.id} tabIndex={-1}>
      <div className="yb-form-decision-buttons" role="radiogroup" aria-label={field.label}>
        {(
          [
            { value: 'approve', label: approve },
            { value: 'reject', label: reject },
          ] as const
        ).map((option) => (
          <button
            key={option.value}
            type="button"
            className={chosen === option.value ? 'yb-form-decision-btn on' : 'yb-form-decision-btn'}
            role="radio"
            aria-checked={chosen === option.value}
            onClick={() => setValue(field.id, { value: option.value, reason })}
          >
            {option.label}
          </button>
        ))}
      </div>
      {field.decision?.ask_reason && (
        <textarea
          rows={2}
          className="yb-form-decision-reason"
          aria-label="Reason for this decision"
          placeholder="Reason (required)"
          value={reason}
          maxLength={2000}
          onChange={(event) => setValue(field.id, { value: chosen, reason: event.target.value })}
        />
      )}
    </div>
  );
}

/**
 * The theme reaches the stylesheet through these custom properties, so no control
 * needs its own inline colour and the live theme can be changed in one place.
 */
function themeVars(theme: FormTheme): React.CSSProperties {
  return {
    ['--yb-accent' as string]: theme.accent,
    ['--yb-radius' as string]: theme.rounded ? '9px' : '2px',
    ['--yb-surface' as string]: theme.background,
    ['--yb-width' as string]: theme.width === 'narrow' ? '460px' : theme.width === 'wide' ? '860px' : '640px',
    ['--yb-label-case' as string]: theme.label_case,
  } as React.CSSProperties;
}
