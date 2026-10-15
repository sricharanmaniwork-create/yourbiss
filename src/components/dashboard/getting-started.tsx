import Link from 'next/link';
import { CalendarDays, Check, FileText, Globe } from 'lucide-react';
import type { DashboardCounts } from '@/lib/repo';
import type { Site } from '@/lib/types';
import { isLive } from '@/lib/modules';
import { cn } from '@/lib/utils';

/**
 * A workspace with nothing in it is the hardest screen in the product: the user
 * has to know what to do next. Steps point only at forms that exist in this
 * build, and each one ticks off from live data rather than a stored "tutorial
 * complete" flag.
 */
export function GettingStarted({ counts, sites }: { counts: DashboardCounts; sites: Site[] }) {
  const allSteps = [
    {
      app: 'website',
      done: counts.sites > 0 && counts.published_pages > 0,
      icon: <Globe size={15} />,
      title: 'Build and publish a page',
      body: counts.sites > 0 ? 'Your site is there — publish a page so visitors can see it.' : 'Start from an empty canvas and drag blocks onto it.',
      href: '/app/websites',
      cta: counts.sites > 0 ? 'Open the builder' : 'Create your first site',
    },
    {
      app: 'forms',
      done: counts.forms > 0,
      icon: <FileText size={15} />,
      title: 'Create a form',
      body: 'Contact, quote or intake form. It can sit on your site or be shared as a link.',
      href: counts.forms > 0 ? '/app/forms' : '/app/forms/new',
      cta: counts.forms > 0 ? 'See your forms' : 'Build a form',
    },
    {
      app: 'bookings',
      done: counts.services > 0 && counts.staff > 0,
      icon: <CalendarDays size={15} />,
      title: 'Open your calendar for bookings',
      body: 'Add a service and your working hours, then put the booking page on your site.',
      href: counts.services > 0 ? '/app/bookings/services' : '/app/bookings/services/new',
      cta: counts.services > 0 ? 'Review services' : 'Add a service',
    },
  ];

  // A step whose screens are not in this build would send the user to the
  // "not yet" page, so it is not a step — it is a promise we cannot keep.
  const steps = allSteps.filter((step) => isLive(step.app));

  const remaining = steps.filter((step) => !step.done).length;
  if (remaining === 0) return null;

  const site = sites[0];

  return (
    <section className="ui-card mb-6 overflow-hidden" aria-labelledby="getting-started">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-raised px-5 py-3">
        <h2 id="getting-started" className="text-[14px] font-semibold">
          {remaining === steps.length
            ? `${steps.length} step${steps.length === 1 ? '' : 's'} to a live business site`
            : `${remaining} step${remaining === 1 ? '' : 's'} left`}
        </h2>
        {site && (
          <Link href={`/app/websites/${site.id}`} className="text-[12.5px] font-medium text-brand hover:underline">
            Skip — take me to the builder
          </Link>
        )}
      </header>
      <ol className="divide-y divide-line">
        {steps.map((step) => (
          <li key={step.title} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
            <span
              className={cn(
                'flex h-6 w-6 flex-none items-center justify-center rounded-full border',
                step.done ? 'border-success bg-success text-white' : 'border-line-strong bg-surface text-[#8b95a3]',
              )}
              aria-hidden="true"
            >
              {step.done ? <Check size={13} /> : step.icon}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn('text-[13.5px] font-medium', step.done ? 'text-muted line-through decoration-[#c8cfd8]' : 'text-ink')}>
                {step.title}
              </p>
              <p className="mt-0.5 text-[12.5px] text-muted">{step.body}</p>
            </div>
            {step.done ? (
              <span className="text-[12px] font-medium text-success">Done</span>
            ) : (
              <Link
                href={step.href}
                className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink hover:bg-raised"
              >
                {step.cta}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
