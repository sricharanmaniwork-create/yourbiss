import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BookingPage } from '@/components/bookings/booking-page';
import { findServiceBySlug, staffOfService } from '@/lib/bookings/public';
import { loadDays, loadSlots } from '@/lib/bookings/availability';
import { dateInZone } from '@/lib/utils';

/**
 * The address a workspace shares: `/book/<workspace>/<service>`.
 *
 * Dynamic on purpose. A booking page rendered yesterday holds yesterday's list of free
 * times, and a service archived this morning must stop taking bookings on the next
 * refresh rather than after the next deploy — the same reason the published site and the
 * public form are never cached.
 *
 * `?staff=` names the person up front. It is a preselect, not a lock: the customer can
 * still switch, and the engine judges every choice by the same rule.
 */
export const dynamic = 'force-dynamic';

interface Params {
  orgSlug: string;
  serviceSlug: string;
}

async function load(params: Params) {
  return findServiceBySlug(params.orgSlug, params.serviceSlug);
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const service = await load(await params);
  if (!service) return { title: 'Booking not found' };

  return {
    title: `Book ${service.name}`,
    description: service.description || undefined,
    // A booking link is sent by the business, not found by a search engine. And a page
    // whose content is a live calendar goes stale in the index the moment someone
    // changes their hours.
    robots: { index: false, follow: false },
  };
}

export default async function PublicBookingPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ staff?: string }>;
}) {
  const service = await load(await params);
  if (!service) notFound();

  const query = await searchParams;

  let team: Awaited<ReturnType<typeof staffOfService>> = [];
  try {
    team = await staffOfService(service.id);
  } catch (error) {
    console.error('[yourbiss] booking page could not read the team', {
      service_id: service.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return (
    <main className="min-h-screen bg-canvas">
      <BookingPage
        service={service}
        team={team}
        today={dateInZone(new Date(), service.timezone)}
        loadDays={loadDays}
        loadSlots={loadSlots}
        defaultStaffId={query.staff}
      />
    </main>
  );
}
