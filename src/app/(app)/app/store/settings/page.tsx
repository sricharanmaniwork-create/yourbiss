import type { Metadata } from 'next';
import Link from 'next/link';
import { Globe, Mail, Package } from 'lucide-react';
import { requireWorkspace } from '@/lib/workspace';
import { getStoreSettings, listSites, storeCounts } from '@/lib/repo';
import { StoreSettingsForm } from '@/components/store/settings-form';
import { ButtonLink, Card, CardBody, CardHeader, PageHeader } from '@/components/ui';
import { formatAmount, formatDateInZone } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Storefront' };

/**
 * The storefront's own two settings, and the three places the rest of a shop is decided.
 *
 * Only the delivery fee and the checkout note belong to Store. The catalogue is
 * Inventory&rsquo;s, one item at a time; the wording of the two letters is on Settings →
 * Email; and the cart itself is a block on a page of the website, so it inherits that
 * page&rsquo;s theme rather than shipping a second storefront to keep in style.
 */
export default async function StoreSettingsPage() {
  const workspace = await requireWorkspace();
  const orgId = workspace.org.id;
  const zone = workspace.org.timezone;
  const locale = workspace.org.locale;
  const currency = workspace.org.currency;

  const [settings, counts, sites] = await Promise.all([getStoreSettings(orgId), storeCounts(orgId), listSites(orgId)]);

  return (
    <>
      <PageHeader
        title="Storefront"
        description="What every basket is charged for delivery, and what a visitor reads before they order."
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid gap-4">
          <StoreSettingsForm
            orgId={orgId}
            shippingFlat={Number(settings?.shipping_flat ?? 0)}
            checkoutNote={settings?.checkout_note ?? null}
          />

          <Card>
            <CardHeader
              title="How a basket is priced"
              description="One row per item, and every number on it read from this workspace when the order is written."
            />
            <CardBody>
              <ul className="grid gap-2 text-[13px] leading-relaxed text-ink-soft">
                <li className="flex gap-2">
                  <Package size={14} className="mt-1 flex-none text-brand" aria-hidden="true" />
                  <span>
                    A line is <span className="font-medium text-ink">quantity × the price on the item</span>, then that
                    line&rsquo;s own tax percentage. Both are copied onto the order, so raising a price tomorrow cannot
                    rewrite an order from today.
                  </span>
                </li>
                <li className="flex gap-2">
                  <Globe size={14} className="mt-1 flex-none text-brand" aria-hidden="true" />
                  <span>
                    Delivery is <span className="font-medium text-ink">added once</span>, at the fee saved above —
                    currently {formatAmount(Number(settings?.shipping_flat ?? 0), currency, locale)}. It does not
                    depend on weight, distance or how many lines there are.
                  </span>
                </li>
                <li className="flex gap-2">
                  <Mail size={14} className="mt-1 flex-none text-brand" aria-hidden="true" />
                  <span>
                    Nothing is charged online. The buyer pays however the note above the checkout button says, and an
                    owner marks the order paid on its screen — so there is no card detail to store, and nothing here can
                    lose a payment.
                  </span>
                </li>
              </ul>
            </CardBody>
          </Card>
        </div>

        <div className="grid gap-4">
          <Card>
            <CardHeader title="What is on sale" description={`${counts.for_sale} item${counts.for_sale === 1 ? '' : 's'} of the list.`} />
            <CardBody>
              <p className="text-[13px] leading-relaxed text-ink-soft">
                An item joins the storefront one switch at a time, on its Inventory screen. Until one is turned on, a
                cart finds nothing to sell and a published page says so.
              </p>
              <ButtonLink href="/app/inventory/items?sale=1" variant="primary" className="mt-3">
                Items on sale
              </ButtonLink>
              <p className="mt-3 text-[12px] leading-relaxed text-muted">
                {counts.sellable_untracked} of them have no shelf to run out of — a service, or a product this
                workspace chose not to count.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Where the cart lives" />
            <CardBody>
              <p className="text-[13px] leading-relaxed text-ink-soft">
                Two blocks on a page: <span className="font-medium text-ink">Product list</span> shows what is on sale
                and <span className="font-medium text-ink">Cart and checkout</span> takes the order. Both are built from
                the same canvas as the rest of the site, so they wear its theme.
              </p>
              {sites.length > 0 ? (
                <ul className="mt-3 divide-y divide-line">
                  {sites.map((site) => (
                    <li key={site.id} className="py-2">
                      <Link
                        href={`/app/websites/${site.id}`}
                        className="block truncate text-[13px] font-medium text-ink hover:text-brand"
                      >
                        {site.name}
                      </Link>
                      <span className="block text-[11.5px] text-muted">
                        {site.status === 'published' && site.published_at
                          ? `live since ${formatDateInZone(site.published_at, zone)}`
                          : 'not published yet'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <>
                  <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
                    This workspace has no website yet, so there is no page to put a cart on.
                  </p>
                  <ButtonLink href="/app/websites" variant="secondary" className="mt-2">
                    Build one
                  </ButtonLink>
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="The letters it sends" />
            <CardBody>
              <p className="text-[13px] leading-relaxed text-ink-soft">
                A buyer gets a receipt with the lines, the totals and the address, the moment the order is written. The
                owner gets told a new order came in, with a link to it. Both are yours to reword.
              </p>
              <ButtonLink href="/app/settings/email" variant="secondary" className="mt-3">
                Reword the letters
              </ButtonLink>
              <p className="mt-3 text-[12px] leading-relaxed text-muted">
                A receipt that could not be sent does not fail the order: the document is already written, and the
                failure is reported to the sender&rsquo;s log rather than to the buyer.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
