'use client';

import { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { Button, ButtonLink, Field, Input, Switch, Textarea, toast } from '@/components/ui';
import { escapeHtml } from '@/lib/utils';

/**
 * The two ways a form reaches a visitor: a link of its own, and a frame that sits
 * inside any page.
 *
 * The address is the one the request came in on, so a preview deployment shares a
 * link that points at the deployment being looked at, and a workspace on its own
 * domain shares that. Nothing here needs a configured site URL to be right.
 */
export function ShareTab({
  form,
  publicPath,
  embedPath,
  origin,
}: {
  form: { id: string; title: string; status: string };
  publicPath: string;
  embedPath: string;
  origin: string;
}) {
  const [titleInFrame, setTitleInFrame] = useState(true);

  // Both addresses read the form through filters that only return a published form
  // in an active workspace, so a draft genuinely answers 404 rather than showing an
  // empty card. Saying so here is the difference between a bug report and a step.
  const draft = form.status !== 'published';
  const link = `${origin}${publicPath}`;
  const frameUrl = `${origin}${embedPath}${titleInFrame ? '' : '?title=off'}`;  const snippet =
    `<iframe src="${escapeHtml(frameUrl)}" title="${escapeHtml(form.title)}" ` +
    'width="100%" height="640" style="border:1px solid #dfe3e9;border-radius:8px;max-width:720px" ' +
    'loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>';

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="ui-card">
        <header className="border-b border-line px-4 py-3">
          <p className="text-[13.5px] font-semibold text-ink">Share the link</p>
          <p className="text-[12px] text-muted">Anyone with it can answer, without a Yourbiss account.</p>
        </header>
        <div className="grid gap-3 px-4 py-4">
          <Field label="Public address" htmlFor="share-link" hint="Works in any browser">
            <div className="flex gap-2">
              <Input id="share-link" readOnly value={link} onFocus={(event) => event.target.select()} />
              <CopyButton text={link} label="Link" />
            </div>
          </Field>

          {draft ? (
            <p className="rounded-md bg-[#fdf3e0] px-3 py-2.5 text-[12px] leading-relaxed text-[#8a5300]">
              This form is a draft, so the address opens a “not found” page rather than the questions. Publish it above
              and the same address starts collecting.
            </p>
          ) : (
            <ButtonLink variant="secondary" href={publicPath} target="_blank" rel="noopener noreferrer" className="justify-self-start">
              <ExternalLink size={14} />
              Preview the live form
            </ButtonLink>
          )}

          <p className="text-[11.5px] leading-relaxed text-muted">
            The link is not a secret. Nothing indexes it — the form asks search engines to stay out — but anyone who is
            sent it can submit it, which is the point of a public form. Give it a closing date, or unpublish it, when you
            have enough answers.
          </p>
        </div>
      </section>

      <section className="ui-card">
        <header className="border-b border-line px-4 py-3">
          <p className="text-[13.5px] font-semibold text-ink">Embed it in a page</p>
          <p className="text-[12px] text-muted">Paste this into any website, including one you built here.</p>
        </header>
        <div className="grid gap-3 px-4 py-4">
          {draft && (
            <p className="rounded-md bg-[#fdf3e0] px-3 py-2.5 text-[12px] leading-relaxed text-[#8a5300]">
              Pasting this now shows an empty frame: the address inside it only serves a published form. Publish the
              form and this code needs no second copy — it starts drawing the questions on its own.
            </p>
          )}

          <div className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2.5">
            <span className="text-[12.5px] text-ink-soft">Show the form title inside the frame</span>
            <Switch checked={titleInFrame} label="Show the form title inside the frame" onChange={setTitleInFrame} />
          </div>

          <Textarea
            readOnly
            rows={6}
            value={snippet}
            spellCheck={false}
            aria-label="Embed code"
            onFocus={(event) => event.target.select()}
            className="font-mono text-[11.5px]"
          />

          <div className="flex items-center gap-2">
            <CopyButton text={snippet} label="Embed code" />
            <span className="text-[11.5px] leading-relaxed text-muted">
              The frame is as tall as the code says; the form scrolls inside it.
            </span>
          </div>

          <p className="text-[11.5px] leading-relaxed text-muted">
            On a Yourbiss page, use the <span className="font-medium text-ink-soft">Form</span> block in the builder
            instead: it picks this form by id, follows its theme, and keeps working if you rename it. The snippet above
            is for a page hosted somewhere else.
          </p>
        </div>
      </section>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(`${label} copied`);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error('Your browser blocked the clipboard. Select the text and copy it by hand.');
    }
  };

  return (
    <Button variant="secondary" onClick={copy} disabled={text === ''}>
      {copied ? <Check size={14} /> : <Copy size={14} />}
      Copy
    </Button>
  );
}
