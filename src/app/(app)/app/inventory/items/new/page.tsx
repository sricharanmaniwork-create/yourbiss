import type { Metadata } from 'next';
import { requireWorkspace } from '@/lib/workspace';
import { ItemForm } from '@/components/inventory/item-form';
import { PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New item' };

export default async function NewItemPage() {
  const workspace = await requireWorkspace();

  return (
    <>
      <PageHeader
        back={{ href: '/app/inventory/items', label: 'Items' }}
        title="New item"
        description="A product has a quantity that the ledger keeps; a service is sold without one. Both can be put on a purchase order, and Store will offer both for sale."
      />
      <ItemForm orgId={workspace.org.id} />
    </>
  );
}
