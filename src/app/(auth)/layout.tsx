import { redirect } from 'next/navigation';
import { getSession } from '@/lib/workspace';
import { YourbissMark } from '@/components/brand/mark';

/**
 * A split screen: the pitch sells the product to someone who has not bought it,
 * the right pane does the one job of getting them in. Both already-signed-in and
 * unconfigured deployments are bounced before the form ever renders.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  // Middleware already does this; repeating it here means the layout is correct
  // even when it is reached by a client-side navigation.
  if (session) redirect('/app');

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <aside className="hidden w-[46%] flex-col justify-between bg-[#0f2b57] px-12 py-10 text-white lg:flex">
        <YourbissMark tone="light" />
        <div>
          <h2 className="max-w-md text-[27px] font-semibold leading-[1.25]">
            Your website, bookings, forms and CRM — in one workspace.
          </h2>
          <p className="mt-4 max-w-md text-[14px] leading-relaxed text-[#b9cdea]">
            Drag blocks onto a blank canvas and publish a real site. Take bookings against availability you control.
            Collect responses and turn them into customers. No plugins, no per-app bills.
          </p>
          <ul className="mt-7 space-y-2.5 text-[13.5px] text-[#d5e2f7]">
            {[
              'Drag-and-drop pages with 34 real blocks',
              'Bookings that respect staff, breaks and timezones',
              'Forms with conditional logic and responses',
              'Your own domain, your own SMTP server',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <span className="mt-[6px] h-[6px] w-[6px] flex-none rounded-full bg-[#5b9bff]" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[12px] text-[#7f9fce]">
          Built for teams that would rather own one tool than rent six.
        </p>
      </aside>

      <main className="flex flex-1 flex-col items-center justify-center px-5 py-10">
        <div className="mb-7 lg:hidden">
          <YourbissMark />
        </div>
        <div className="w-full max-w-[400px]">
          {children}
        </div>
      </main>
    </div>
  );
}
