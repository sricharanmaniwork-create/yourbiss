import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BookingPage } from '@/components/bookings/booking-page';
import { findServiceById, staffOfService } from '@/lib/bookings/public';
import { loadDays, loadSlots } from '@/lib/bookings/availability';
import { dateInZone } from '@/lib/utils';

/**
 * The frame a published site puts a booking page in — `/embed/book/<id>`.
 *
 * Addressed by id, not by slug, because the block on someone's page holds the id it was
 * given in the builder and cannot be expected to know the workspace's address. That is
 * also what makes the frame survive a slug change.
 *
 * Same-origin by construction, which is what lets `/api/book` insist on a same-origin
 * post and still accept one from inside the frame. A booking made here is recorded with
 * `source = 'embed'`, so the workspace can tell a booking that came from its own site.
 */
export const dynamic = 'force-dynamic';

interface Params {
  serviceId: string;
}

export const metadata: Metadata = {
  title: 'Book a time',
  robots: { index: false, follow: false },
};

export default async function BookingEmbedPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ staff?: string }>;
}) {
  const { serviceId } = await params;
  const query = await searchParams;

  const service = await findServiceById(serviceId);
  if (!service) notFound();

  let team: Awaited<ReturnType<typeof staffOfService>> = [];
  try {
    team = await staffOfService(service.id);
  } catch (error) {
    console.error('[yourbiss] booking frame could not read the team', {
      service_id: service.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return (
    <BookingPage
      variant="embed"
      service={service}
      team={team}
      today={dateInZone(new Date(), service.timezone)}
      loadDays={loadDays}
      loadSlots={loadSlots}
      defaultStaffId={query.staff}
    />
  );
}
