import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Globe } from 'lucide-react';
import { moduleByPathname } from '@/lib/modules';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: 'Not in this build yet' };

/**
 * Everything the rail names but this build has not shipped lands here. The
 * alternatives were a 404, which reads as a bug, or a screen full of demo rows,
 * which reads as a finished product — and neither is true.
 */
export default async function UnbuiltAppPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const target = moduleByPathname(`/app/${slug.join('/')}`);

  // A mistyped path inside an app that *does* have screens has to stay a 404 —
  // /app/settings/membe must not claim that Settings was never built.
  if (!target || target.state === 'live') notFound();

  const Icon = target.icon;

  return (
    <div className="mx-auto max-w-[720px]">
      <Link href="/app" className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-brand">
        <ArrowLeft size={13} aria-hidden="true" />
        Back to dashboard
      </Link>
      <section className="ui-card">
        <EmptyState
          icon={<Icon size={19} />}
          title={`${target.label} is not in this build yet`}
          description={`${target.tagline} It is listed in the sidebar so you can see where the workspace is going, but there is no screen behind it — no demo table, no placeholder records, nothing that pretends to work.`}
          action={
            <>
              <ButtonLink href="/app/websites" variant="primary" size="md">
                <Globe size={14} aria-hidden="true" />
                Build a website
              </ButtonLink>
              <ButtonLink href="/app/settings/apps" variant="secondary" size="md">
                See the app list
              </ButtonLink>
            </>
          }
          className="py-16"
        />
      </section>
    </div>
  );
}
