'use client';

import { useMemo, useRef, useState, type FormEvent } from 'react';
import { checkAnswers } from '@/lib/forms/answers';
import { orderedFields } from '@/lib/forms/definition';
import { fieldIsVisible, isPresentational, type FormFieldDef, type FormSettings, type FormTheme } from '@/lib/forms/types';

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

export function PublicForm({ formId, title, description, fields, settings, theme, variant = 'page' }: PublicFormProps) {
  const ordered = useMemo(() => orderedFields(fields, settings.field_order), [fields, settings.field_order]);
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [trapped, setTrapped] = useState('');
  const [finished, setFinished] = useState<string | null>(null);
  const ref = useRef<HTMLFormElement>(null);

  // A field its logic hides is not asked for, not validated, and not sent.
  const shown = useMemo(() => ordered.filter((field) => fieldIsVisible(field, answers)), [ordered, answers]);

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

    const check = checkAnswers(fields, settings.field_order, payload);
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
          <FieldRow key={field.id} field={field} value={answers[field.id]} error={errors[field.id]} setValue={setValue} />
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

function FieldRow({
  field,
  value,
  error,
  setValue,
}: {
  field: FormFieldDef;
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

  if (['radio', 'checkbox', 'multiselect'].includes(field.type)) {
    return (
      <fieldset className={`yb-form-field yb-form-group${half}`} data-field={field.id}>
        <legend className="yb-form-label">
          {field.label}
          {field.required && <span className="yb-form-req">*</span>}
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

  return (
    <div className={`yb-form-field${half}`} data-field={field.id}>
      {field.type !== 'checkbox_single' && (
        <label className="yb-form-label" htmlFor={field.id}>
          {field.label}
          {field.required && <span className="yb-form-req">*</span>}
        </label>
      )}
      <Control field={field} value={value} error={!!error} setValue={setValue} describedBy={describedBy} />
      {field.help && <p id={`${field.id}-help`} className="yb-form-help">{field.help}</p>}
      {error && (
        <p id={`${field.id}-error`} className="yb-form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
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
  const multi = field.type === 'checkbox' || field.type === 'multiselect';

  return (
    <div className="yb-form-choices">
      {(field.options ?? []).map((option, index) => {
        const inputId = `${field.id}-${index}`;
        const checked = multi ? chosen.includes(String(option.value)) : chosen[0] === String(option.value);
        return (
          <label key={`${option.value}-${index}`} className="yb-form-choice" htmlFor={inputId}>
            <input
              id={inputId}
              type={multi ? 'checkbox' : 'radio'}
              name={field.id}
              value={option.value}
              checked={checked}
              data-control={field.id}
              onChange={() =>
                setValue(
                  field.id,
                  multi
                    ? checked
                      ? chosen.filter((x) => x !== String(option.value))
                      : [...chosen, String(option.value)]
                    : option.value,
                )
              }
            />
            <span>{option.label}</span>
          </label>
        );
      })}
    </div>
  );
}

function Control({
  field,
  value,
  error,
  setValue,
  describedBy,
}: {
  field: FormFieldDef;
  value: unknown;
  error: boolean;
  setValue: (id: string, value: unknown) => void;
  describedBy: string;
}) {
  const text = value === undefined || value === null ? '' : String(value);
  const v = field.validation ?? {};
  const shared = {
    id: field.id,
    name: field.id,
    'data-control': field.id,
    placeholder: field.placeholder ?? undefined,
    'aria-invalid': error || undefined,
    'aria-describedby': describedBy || undefined,
    'aria-required': field.required || undefined,
  };

  switch (field.type) {
    case 'textarea':
      return (
        <textarea
          {...shared}
          rows={4}
          value={text}
          minLength={v.min_len}
          maxLength={v.max_len ?? 8000}
          onChange={(event) => setValue(field.id, event.target.value)}
        />
      );

    case 'email':
      return (
        <input
          {...shared}
          type="email"
          autoComplete="email"
          inputMode="email"
          value={text}
          maxLength={v.max_len ?? 320}
          onChange={(event) => setValue(field.id, event.target.value)}
        />
      );

    case 'phone':
      return (
        <input
          {...shared}
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          value={text}
          maxLength={v.max_len ?? 32}
          onChange={(event) => setValue(field.id, event.target.value)}
        />
      );

    case 'url':
      return (
        <input
          {...shared}
          type="url"
          inputMode="url"
          placeholder={field.placeholder ?? 'https://'}
          value={text}
          maxLength={v.max_len ?? 600}
          onChange={(event) => setValue(field.id, event.target.value)}
        />
      );

    case 'number':
    case 'rupees':
      return (
        <span className={field.type === 'rupees' ? 'yb-form-money' : undefined}>
          {field.type === 'rupees' && <span aria-hidden="true">₹</span>}
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
        </span>
      );

    case 'date':
      return <input {...shared} type="date" value={text} onChange={(event) => setValue(field.id, event.target.value)} />;

    case 'time':
      return <input {...shared} type="time" value={text} onChange={(event) => setValue(field.id, event.target.value)} />;

    case 'select':
      return (
        <select {...shared} value={text} data-control={field.id} onChange={(event) => setValue(field.id, event.target.value)}>
          <option value="">{field.placeholder || 'Choose one…'}</option>
          {(field.options ?? []).map((option, index) => (
            <option key={`${option.value}-${index}`} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );

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
            aria-required={field.required || undefined}
            onChange={(event) => setValue(field.id, event.target.checked)}
          />
          <span>{field.label}</span>
        </label>
      );

    case 'rating': {
      const current = Number(value) || 0;
      return (
        <div className="yb-form-rating" role="radiogroup" aria-label={field.label} data-control={field.id} tabIndex={0}>
          {[1, 2, 3, 4, 5].map((score) => (
            <button
              type="button"
              key={score}
              className={score <= current ? 'yb-form-star on' : 'yb-form-star'}
              role="radio"
              aria-checked={score === current}
              aria-label={`${score} of 5`}
              onClick={() => setValue(field.id, score)}
            >
              {score}
            </button>
          ))}
        </div>
      );
    }

    default:
      return (
        <input
          {...shared}
          type="text"
          autoComplete={field.type === 'name' ? 'name' : undefined}
          value={text}
          minLength={v.min_len}
          maxLength={v.max_len ?? 2000}
          pattern={field.type === 'text' || field.type === 'name' ? v.pattern : undefined}
          onChange={(event) => setValue(field.id, event.target.value)}
        />
      );
  }
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
