import type { Metadata } from 'next';
import Link from 'next/link';
import { FileInput } from 'lucide-react';
import { requireWorkspace } from '@/lib/workspace';
import { listForms } from '@/lib/repo';
import { PageHeader } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { NewFormButton } from '@/components/forms/new-form-button';
import { formatInZone } from '@/lib/utils';

export const metadata: Metadata = { title: 'Forms' };

export default async function FormsPage() {
  const workspace = await requireWorkspace();
  const forms = await listForms(workspace.org.id);

  // Building a form is open to every member — the same freedom the database gives
  // them. What closes it is the Forms app being switched off for this workspace,
  // which is checked by the identical policy on the write.
  const canBuild = workspace.apps.forms === true;

  return (
    <>
      <PageHeader
        title="Forms"
        description="Every form in this workspace, whether it is still a draft or already taking responses from a link or a page."
        actions={canBuild ? <NewFormButton orgId={workspace.org.id} orgSlug={workspace.org.slug} /> : undefined}
      />

      {forms.length === 0 ? (
        <EmptyState
          icon={<FileInput size={22} />}
          title="No forms yet"
          description="A form starts empty: add the questions you actually want answered, then publish it to get a link you can share or embed."
          action={
            canBuild ? (
              <NewFormButton orgId={workspace.org.id} orgSlug={workspace.org.slug} />
            ) : (
              <p className="text-[12.5px] text-muted">
                The Forms app is switched off for this workspace, so nothing can be added until an owner or admin turns
                it back on in Settings.
              </p>
            )
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {forms.map((form) => (
            <li key={form.id} className="ui-card">
              <Link
                href={`/app/forms/${form.id}`}
                className="block px-4 py-3.5 transition-colors hover:bg-raised"
                aria-label={`Open ${form.title}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 truncate text-[14px] font-semibold text-ink">{form.title}</p>
                  <StatusBadge state={form.status} />
                </div>
                <p className="mt-1 truncate font-mono text-[11.5px] text-muted">/f/{workspace.org.slug}/{form.slug}</p>
                <p className="mt-2 text-[12px] text-muted">
                  {form.fields.length} field{form.fields.length === 1 ? '' : 's'} ·{' '}
                  {form.submission_count === 0
                    ? 'no responses yet'
                    : `${form.submission_count} response${form.submission_count === 1 ? '' : 's'}`}
                </p>
                <p className="mt-1 text-[12px] text-muted">
                  {form.published_at
                    ? `Published ${formatInZone(form.published_at, workspace.org.timezone, { dateStyle: 'medium', timeStyle: 'short' })}`
                    : `Edited ${formatInZone(form.updated_at, workspace.org.timezone, { dateStyle: 'medium', timeStyle: 'short' })}`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {!canBuild && (
        <p className="mt-4 max-w-[720px] text-[12.5px] leading-relaxed text-muted">
          The Forms app is switched off for this workspace, so these forms can be read but not changed. A link already
          shared, and a form already embedded on a published page, keeps collecting until it is deleted — switching the
          app off is not a way to take a form down.
        </p>
      )}

      {canBuild && workspace.role === 'member' && (
        <p className="mt-4 max-w-[720px] text-[12.5px] leading-relaxed text-muted">
          You are a member of this workspace, so you can build a form, publish it and read the responses it collects.
          Archiving or deleting a form and changing who gets notified are for the owner and admins.
        </p>
      )}
    </>
  );
}
