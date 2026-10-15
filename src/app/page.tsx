import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarDays, FileText, Globe, Package, ShoppingCart, Users, Workflow } from 'lucide-react';
import { YourbissMark } from '@/components/brand/mark';
import { getSession } from '@/lib/workspace';

export const metadata: Metadata = {
  title: 'Yourbiss — website builder, bookings, forms and CRM in one workspace',
  description:
    'Drag blocks onto a canvas and publish a real website. Take bookings against availability you control, collect form responses, and keep every customer record in the same place.',
};

// The header CTA depends on whether a session cookie is present, so this cannot
// be prerendered once at build time.
export const dynamic = 'force-dynamic';

const APPS = [
  { name: 'Websites', icon: Globe, body: 'A blank canvas, 34 blocks, and a publish button that versions the whole site.', live: true },
  { name: 'Bookings', icon: CalendarDays, body: 'Services, staff calendars, breaks and timezones. Customers pick a slot that is genuinely free.', live: true },
  { name: 'Forms', icon: FileText, body: 'Conditional logic, file intake, responses you can export. Embed it in any page you build.', live: true },
  { name: 'Store', icon: ShoppingCart, body: 'Product pages and carts built from the same canvas, priced from your inventory.', live: false },
  { name: 'CRM', icon: Users, body: 'Every form response and booking becomes a contact with a real activity timeline.', live: false },
  { name: 'Inventory', icon: Package, body: 'Stock, pricing, offers and suppliers — the numbers behind the store.', live: false },
  { name: 'Automations', icon: Workflow, body: 'When something happens in one app, do something in another. Rules, not guesses.', live: false },
];

export default async function LandingPage() {
  const session = await getSession();

  return (
    <div className="min-h-screen bg-surface">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1080px] items-center justify-between px-5">
          <YourbissMark />
          <nav className="flex items-center gap-2">
            {session ? (
              <Link href="/app" className="inline-flex h-9 items-center rounded-md bg-brand px-4 text-[13.5px] font-medium text-white hover:bg-brand-dark">
                Open workspace
              </Link>
            ) : (
              <>
                <Link href="/login" className="inline-flex h-9 items-center rounded-md px-3 text-[13.5px] font-medium text-ink-soft hover:bg-black/[0.05]">
                  Sign in
                </Link>
                <Link href="/signup" className="inline-flex h-9 items-center rounded-md bg-brand px-4 text-[13.5px] font-medium text-white hover:bg-brand-dark">
                  Create workspace
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-[1080px] px-5 pb-16 pt-16 lg:pt-20">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#c7dbfb] bg-brand-soft px-3 py-1 text-[12px] font-medium text-brand-dark">
                Websites · Bookings · Forms — live today
              </p>
              <h1 className="text-[38px] font-semibold leading-[1.14] tracking-[-0.025em] text-ink sm:text-[46px]">
                Run the whole business from one canvas.
              </h1>
              <p className="mt-5 max-w-[520px] text-[15.5px] leading-relaxed text-ink-soft">
                Yourbiss is one workspace where your site, your booking calendar and your customer records share the
                same data. Drag a booking page onto your homepage. Drop a form into a section. Nothing to wire up,
                because it is the same app.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href="/signup" className="inline-flex h-11 items-center rounded-md bg-brand px-6 text-[14.5px] font-medium text-white hover:bg-brand-dark">
                  Create your workspace free
                </Link>
                <Link href="/login" className="inline-flex h-11 items-center rounded-md border border-line-strong px-5 text-[14.5px] font-medium text-ink hover:bg-raised">
                  I already have one
                </Link>
              </div>
              <p className="mt-4 text-[12.5px] text-muted">
                Your own domain, your own SMTP server, your own database rows. No AI writing your copy for you.
              </p>
            </div>

            <BuilderPreview />
          </div>
        </section>

        <section className="border-t border-line bg-canvas py-16">
          <div className="mx-auto max-w-[1080px] px-5">
            <h2 className="text-[24px] font-semibold tracking-[-0.02em]">Add the apps you need. Leave the rest off.</h2>
            <p className="mt-2 max-w-[640px] text-[14.5px] leading-relaxed text-ink-soft">
              A workspace is not a bundle you are forced to buy. Switch on the modules your business uses; the others
              stay out of your sidebar.
            </p>
            <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {APPS.map((app) => (
                <article key={app.name} className="ui-card px-5 py-5">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-[7px] bg-brand-soft text-brand">
                      <app.icon size={16} />
                    </span>
                    <h3 className="text-[14.5px] font-semibold">{app.name}</h3>
                    {!app.live && (
                      <span className="ml-auto rounded-full border border-[#dfe3e9] bg-[#eef0f3] px-2 py-[1px] text-[11px] text-[#7a848f]">
                        next
                      </span>
                    )}
                  </div>
                  <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">{app.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-line py-16">
          <div className="mx-auto max-w-[1080px] px-5">
            <h2 className="text-[24px] font-semibold tracking-[-0.02em]">Security you can read, not just trust</h2>
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { title: 'Row-level security', body: 'Every business table carries an org id. Postgres decides what you may see — not a filter in a route handler.' },
                { title: 'Anonymous gets nothing', body: 'The public roles have zero table privileges. Public pages are rendered by server routes with validated queries.' },
                { title: 'Secrets stay encrypted', body: 'Your SMTP password is stored AES-256-GCM in a table with no read policy at all.' },
                { title: 'Writes go through rules', body: 'Form submits and bookings are Postgres functions that re-check the slot, the fields and the rate limit.' },
              ].map((item) => (
                <div key={item.title}>
                  <h3 className="text-[13.5px] font-semibold text-ink">{item.title}</h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-line bg-[#0f2b57] py-14 text-white">
          <div className="mx-auto flex max-w-[1080px] flex-wrap items-center justify-between gap-6 px-5">
            <div>
              <h2 className="text-[22px] font-semibold">Start with an empty canvas today.</h2>
              <p className="mt-2 text-[14px] text-[#b9cdea]">
                A workspace, a site with two pages, a form and a booking service — set up in under a minute.
              </p>
            </div>
            <Link href="/signup" className="inline-flex h-11 items-center rounded-md bg-white px-6 text-[14.5px] font-medium text-[#0f2b57] hover:bg-[#eaf1fe]">
              Create workspace
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line py-8">
        <div className="mx-auto flex max-w-[1080px] flex-wrap items-center justify-between gap-3 px-5 text-[12.5px] text-muted">
          <YourbissMark />
          <p>© {new Date().getFullYear()} Yourbiss. Built for teams that would rather own one tool than rent six.</p>
        </div>
      </footer>
    </div>
  );
}

/**
 * A still of the builder rather than a screenshot: it shows the three panels
 * that actually exist in the product, and it stays sharp at any size.
 */
function BuilderPreview() {
  return (
    <div className="ui-card overflow-hidden p-0" aria-hidden="true">
      <div className="flex items-center gap-2 border-b border-line bg-raised px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-[#d3d8e0]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#d3d8e0]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#d3d8e0]" />
        <span className="ml-2 flex-1 truncate rounded border border-line bg-surface px-2 py-[3px] text-[11px] text-muted">
          northsidedental.yourbiss.app
        </span>
        <span className="rounded bg-brand px-2 py-[3px] text-[11px] font-medium text-white">Publish</span>
      </div>
      <div className="grid grid-cols-[54px_1fr_86px] gap-0">
        <div className="space-y-1.5 border-r border-line bg-raised p-1.5">
          {['Section', 'Text', 'Image', 'Button', 'Form', 'Book'].map((label) => (
            <div key={label} className="rounded border border-line bg-surface px-1 py-1.5 text-center text-[8.5px] text-muted">
              {label}
            </div>
          ))}
        </div>
        <div className="p-3">
          <div className="rounded-md border border-dashed border-line-strong bg-canvas p-3">
            <div className="rounded bg-[#0f2b57] px-3 py-3">
              <div className="h-2 w-2/3 rounded bg-white/70" />
              <div className="mt-1.5 h-1.5 w-1/2 rounded bg-white/40" />
              <div className="mt-3 h-3.5 w-16 rounded bg-brand" />
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="rounded border border-line bg-surface p-2">
                  <div className="h-6 rounded bg-[#eaf1fe]" />
                  <div className="mt-1.5 h-1.5 w-3/4 rounded bg-[#dfe3e9]" />
                </div>
              ))}
            </div>
            <div className="mt-2 rounded border border-dashed border-brand bg-brand-soft/50 p-2">
              <p className="text-[9.5px] font-medium text-brand-dark">Drop a booking page here</p>
            </div>
          </div>
        </div>
        <div className="space-y-1.5 border-l border-line bg-raised p-1.5">
          {['Background', 'Radius', 'Gap', 'Align', 'Link'].map((label) => (
            <div key={label} className="rounded border border-line bg-surface px-1 py-1 text-[8.5px] text-muted">
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
