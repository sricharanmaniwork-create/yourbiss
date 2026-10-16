'use client';

import { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { Button, ButtonLink, Field, Input, Select, Switch, Textarea, toast } from '@/components/ui';
import { escapeHtml } from '@/lib/utils';

/**
 * The two ways this service reaches a customer: a page of its own, and a frame inside
 * any site.
 *
 * Both are built from the origin the request came in on, so a preview deployment shares
 * a link that points at the deployment being looked at and a workspace on its own domain
 * shares that. The frame is addressed by service id, which is what lets a published page
 * keep working when the workspace renames the service or changes its address.
 */
export function ServiceShareTab({
  service,
  orgSlug,
  origin,
  offering,
}: {
  service: { id: string; name: string; slug: string; status: 'active' | 'hidden' | 'archived' };
  orgSlug: string;
  origin: string;
  offering: { id: string; name: string }[];
}) {
  const [staffId, setStaffId] = useState('');
  const [tall, setTall] = useState(true);

  const publicPath = `/book/${orgSlug}/${service.slug}`;
  const link = staffId === '' ? `${origin}${publicPath}` : `${origin}${publicPath}?staff=${encodeURIComponent(staffId)}`;
  const frameUrl =
    `${origin}/embed/book/${service.id}` +
    (staffId === '' ? '' : `?staff=${encodeURIComponent(staffId)}`);
  const snippet =
    `<iframe src="${escapeHtml(frameUrl)}" title="${escapeHtml(`Book ${service.name}`)}" ` +
    `width="100%" height="${tall ? 720 : 560}" style="border:1px solid #dfe3e9;border-radius:10px;max-width:820px" ` +
    'loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>';

  const closed = service.status !== 'active';

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="ui-card">
        <header className="border-b border-line px-4 py-3">
          <p className="text-[13.5px] font-semibold text-ink">Send the booking page</p>
          <p className="text-[12px] text-muted">No account, no sign-in — a customer only needs the link.</p>
        </header>
        <div className="grid gap-3 px-4 py-4">
          <Field label="Public address" htmlFor="book-link" hint="Works in any browser">
            <div className="flex gap-2">
              <Input id="book-link" readOnly value={link} onFocus={(event) => event.target.select()} />
              <CopyButton text={link} label="Link" />
            </div>
          </Field>

          <Field
            label="Open with one person chosen"
            htmlFor="book-staff"
            hint={offering.length === 0 ? 'Nobody offers this service yet' : 'A starting point, not a lock — the customer can still switch'}
          >
            <Select id="book-staff" value={staffId} onChange={(event) => setStaffId(event.target.value)}>
              <option value="">Anyone who offers it</option>
              {offering.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </Select>
          </Field>

          {closed ? (
            <p className="rounded-md bg-[#fdf3e0] px-3 py-2.5 text-[12px] leading-relaxed text-[#8a5300]">
              {service.status === 'hidden'
                ? 'This service is hidden, so the address answers “not found” and nothing can be booked. Set it back to active above and the same link works again.'
                : 'This service is archived, so the address answers “not found”. Appointments already made against it stay readable by reference.'}
            </p>
          ) : offering.length === 0 ? (
            <p className="rounded-md bg-[#fdf3e0] px-3 py-2.5 text-[12px] leading-relaxed text-[#8a5300]">
              Nobody offers this service yet, so the page opens with a calendar and no times. Assign someone on the Team
              tab and this same address starts offering slots.
            </p>
          ) : (
            <ButtonLink href={publicPath} target="_blank" rel="noopener noreferrer" variant="secondary" className="justify-self-start">
              <ExternalLink size={14} />
              Preview the live page
            </ButtonLink>
          )}

          <p className="text-[11.5px] leading-relaxed text-muted">
            The link is not a secret and nothing indexes it — a booking page asks search engines to stay out. Anyone who
            is sent it can take a slot, which is the point.
          </p>
        </div>
      </section>

      <section className="ui-card">
        <header className="border-b border-line px-4 py-3">
          <p className="text-[13.5px] font-semibold text-ink">Put it in a page</p>
          <p className="text-[12px] text-muted">Paste this into any website, including one you built here.</p>
        </header>
        <div className="grid gap-3 px-4 py-4">
          <div className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2.5">
            <span className="text-[12.5px] text-ink-soft">Give the frame room for a full month of times</span>
            <Switch checked={tall} label="Taller frame" onChange={setTall} />
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
              The calendar scrolls inside the frame; the height only decides how much shows at once.
            </span>
          </div>

          <p className="text-[11.5px] leading-relaxed text-muted">
            On a Yourbiss page, use the <span className="font-medium text-ink-soft">Booking</span> block in the builder
            instead: it picks this service by id, survives a rename or an address change, and can hold a chosen person.
            The snippet above is for a page hosted somewhere else.
          </p>

          <p className="text-[11.5px] leading-relaxed text-muted">
            The frame shows the times that exist at the moment it loads, so a customer who leaves a booking page open
            overnight sees an old grid until they refresh. A slot that has been taken in the meantime is refused at the
            database rather than double-booked.
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
