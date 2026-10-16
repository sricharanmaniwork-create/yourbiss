'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, Rocket } from 'lucide-react';
import type { FormPrivateRow, FormSubmissionRow } from '@/lib/types';
import type { FormFieldDef, FormSettings, FormTheme } from '@/lib/forms/types';
import { setFormStatus } from '@/lib/actions/forms';
import { Badge, Button, ButtonLink, PageHeader, StatusBadge, Tabs, toast, type TabItem } from '@/components/ui';
import { formatInZone } from '@/lib/utils';
import { isFormClosed } from '@/lib/forms/definition';
import { BuildTab } from './build-tab';
import { ResponsesTab } from './responses-tab';
import { SettingsTab } from './settings-tab';
import { ShareTab } from './share-tab';

type Panel = 'build' | 'responses' | 'settings' | 'share';

export interface FormDocument {
  id: string;
  orgId: string;
  title: string;
  description: string;
  slug: string;
  status: 'draft' | 'published' | 'archived';
  fields: FormFieldDef[];
  settings: FormSettings;
  theme: FormTheme;
  submissionCount: number;
  publishedAt: string | null;
  updatedAt: string;
}

/**
 * One form, four panels.
 *
 * Build and Settings both write the same document, one row per save. They are
 * separate tabs because the work is different — one is asking questions, the other
 * is deciding what happens to the answers — but a save from either carries the
 * other's half untouched, so nothing can be lost by switching tabs mid-edit.
 */
export function FormOverview({
  form,
  privates,
  submissions,
  orgSlug,
  timezone,
  origin,
  canManage,
  canAdmin,
}: {
  form: FormDocument;
  privates: (FormPrivateRow & { hasSecret: boolean }) | null;
  submissions: FormSubmissionRow[];
  orgSlug: string;
  timezone: string;
  origin: string;
  canManage: boolean;
  canAdmin: boolean;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>('build');
  const [pending, startTransition] = useTransition();

  const publicPath = `/f/${orgSlug}/${form.slug}`;
  const embedPath = `/embed/form/${form.id}`;
  const closed = useMemo(() => isFormClosed(form.settings.close_at), [form.settings.close_at]);

  const tabs: TabItem[] = [
    { id: 'build', label: 'Build', badge: form.fields.length },
    { id: 'responses', label: 'Responses', badge: form.submissionCount },
    { id: 'settings', label: 'Settings' },
    { id: 'share', label: 'Share' },
  ];

  const setStatus = (status: 'draft' | 'published' | 'archived') => {
    startTransition(async () => {
      const result = await setFormStatus(form.id, status).catch((e: unknown) => ({
        ok: false as const,
        error: e instanceof Error ? e.message : 'That change did not stick',
      }));
      if (!result.ok) {
        toast.error(result.error ?? 'That change did not stick');
        return;
      }
      toast.success(status === 'published' ? 'The form is live' : status === 'archived' ? 'The form is archived' : 'Back to draft');
      router.refresh();
    });
  };

  return (
    <>
      <PageHeader
        back={{ href: '/app/forms', label: 'Forms' }}
        title={form.title}
        description={`Answers arrive at ${publicPath} once the form is published, or inside any page that embeds it.`}
        actions={
          <>
            {form.status === 'published' && !closed && (
              <ButtonLink href={publicPath} target="_blank" rel="noopener noreferrer" variant="secondary">
                <ExternalLink size={14} />
                Open form
              </ButtonLink>
            )}
            {canManage && form.status !== 'published' && (
              <Button variant="primary" loading={pending} onClick={() => setStatus('published')}>
                <Rocket size={14} />
                Publish
              </Button>
            )}
            {canManage && form.status === 'published' && (
              <Button variant="secondary" loading={pending} onClick={() => setStatus('draft')}>
                Unpublish
              </Button>
            )}
          </>
        }
      />

      <div className="ui-card mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11.5px] text-muted">{publicPath}</span>
          <StatusBadge state={form.status} />
          {closed && <Badge tone="warning">Closed to new responses</Badge>}
        </div>
        <p className="text-[12px] text-muted">
          {form.publishedAt
            ? `Published ${formatInZone(form.publishedAt, timezone, { dateStyle: 'medium', timeStyle: 'short' })}`
            : 'Never published'}
        </p>
        <p className="text-[12px] text-muted">
          {form.submissionCount === 0
            ? 'No responses yet'
            : `${form.submissionCount} response${form.submissionCount === 1 ? '' : 's'} recorded`}
        </p>
        {!canManage && <Badge tone="neutral">Read-only</Badge>}
      </div>

      <Tabs items={tabs} value={panel} onChange={(id) => setPanel(id as Panel)} className="mb-4" />

      {panel === 'build' && (
        <BuildTab
          form={form}
          orgSlug={orgSlug}
          canManage={canManage}
          onSaved={() => router.refresh()}
        />
      )}
      {panel === 'responses' && (
        <ResponsesTab
          form={form}
          submissions={submissions}
          publicPath={publicPath}
          timezone={timezone}
          canManage={canManage}
          canAdmin={canAdmin}
          onChanged={() => router.refresh()}
        />
      )}
      {panel === 'settings' && (
        <SettingsTab
          form={form}
          privates={privates}
          orgSlug={orgSlug}
          timezone={timezone}
          canManage={canManage}
          canAdmin={canAdmin}
          onSaved={() => router.refresh()}
        />
      )}
      {panel === 'share' && <ShareTab form={form} publicPath={publicPath} embedPath={embedPath} origin={origin} />}
    </>
  );
}
