import type { Metadata } from 'next';
import { requireWorkspace } from '@/lib/workspace';
import { SupplierForm } from '@/components/inventory/supplier-form';
import { PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'New supplier' };

export default async function NewSupplierPage() {
  const workspace = await requireWorkspace();

  return (
    <>
      <PageHeader
        back={{ href: '/app/inventory/suppliers', label: 'Suppliers' }}
        title="New supplier"
        description="Where the goods come from. A purchase order cannot be written without one, so this is the first thing to fill in."
      />
      <SupplierForm orgId={workspace.org.id} />
    </>
  );
}
