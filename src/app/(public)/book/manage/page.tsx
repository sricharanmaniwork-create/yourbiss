import type { Metadata } from 'next';
import { ManagePanel } from '@/components/bookings/manage-panel';
import { loadDays, loadSlots } from '@/lib/bookings/availability';

/**
 * `/book/manage` — the one address a confirmation mail points at besides the booking
 * page itself.
 *
 * The link carries `?code=` so the reference arrives filled in, and stops there. The
 * email address is still asked for, on the page, because the reference on its own is a
 * lookup key rather than a secret: nine characters from a 31-letter alphabet is a
 * searchable space, and what it identifies is someone's name, address and diary.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Manage your booking',
  robots: { index: false, follow: false },
};

export default async function ManageBookingPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const query = await searchParams;
  const code = (query.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);

  return (
    <main className="min-h-screen bg-canvas px-4 py-10">
      <div className="mx-auto w-full max-w-[560px]">
        <div className="rounded-lg border border-line bg-surface p-6 shadow-panel">
          <h1 className="text-[19px] font-semibold text-ink">Your booking</h1>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
            Move it, or let the business know you are not coming.
          </p>
          <div className="mt-5 border-t border-line pt-5">
            <ManagePanel initialCode={code} loadDays={loadDays} loadSlots={loadSlots} />
          </div>
        </div>
        <p className="mt-4 text-center text-[11.5px] text-ink-muted">
          Ran into trouble with the times shown? The business sees the same calendar you do.
        </p>
      </div>
    </main>
  );
}
