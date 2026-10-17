import type { Metadata } from 'next';
import { requireWorkspace } from '@/lib/workspace';
import { listInvSuppliers } from '@/lib/repo';
import { PurchaseForm } from '@/components/inventory/purchase-form';
import { PageHeader } from '@/components/ui';
import { dateInZone } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New purchase order' };

export default async function NewPurchasePage() {
  const workspace = await requireWorkspace();
  const suppliers = await listInvSuppliers(workspace.org.id, { status: 'active', limit: 300 });

  return (
    <>
      <PageHeader
        back={{ href: '/app/inventory/purchases', label: 'Purchase orders' }}
        title="New purchase order"
        description="Who it goes to, when it was placed and when the goods are meant to arrive. Its number comes from the workspace's own counter the moment the draft is created."
      />
      <PurchaseForm
        orgId={workspace.org.id}
        suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name }))}
        today={dateInZone(new Date(), workspace.org.timezone)}
      />
    </>
  );
}
