import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/workspace';
import { requestOrigin } from '@/lib/app-url';
import { getForm, getFormPrivates, listFormSubmissions } from '@/lib/repo';
import {
  FORM_SETTINGS_DEFAULT,
  FORM_THEME_DEFAULT,
  formFieldSchema,
  formSettingsSchema,
  formThemeSchema,
  type FormFieldDef,
  type FormSettings,
  type FormTheme,
} from '@/lib/forms/types';
import { FormOverview, type FormDocument } from '@/components/forms/form-overview';
import { PageHeader } from '@/components/ui/card';
import { ButtonLink } from '@/components/ui';

/**
 * One form: its questions, its answers, its settings.
 *
 * The row is read through the member's own session, so RLS decides whether it exists
 * for them at all. The `org_id` comparison after that is only there to stop someone
 * who belongs to two workspaces from reaching the other one's form by pasting its id
 * into the address bar while the first workspace is selected.
 *
 * `form_privates` is read only for an owner or admin — the policy would return
 * nothing anyway — and the webhook secret is reduced to "there is one" before it
 * reaches the browser.
 */
export const dynamic = 'force-dynamic';

interface Params {
  formId: string;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { formId } = await params;
  const form = await getForm(formId);
  return { title: form ? form.title : 'Form' };
}

export default async function FormOverviewRoute({ params }: { params: Promise<Params> }) {
  const { formId } = await params;
  const workspace = await requireWorkspace();

  const form = await getForm(formId);
  if (!form || form.org_id !== workspace.org.id || form.status === 'archived') notFound();

  const canAdmin = workspace.role === 'owner' || workspace.role === 'admin';

  // A hand-edited or future-versioned row can hold a document this build cannot read.
  // Refusing the screen is the safe answer: falling back to an empty field list and
  // letting someone press save would delete questions that are still in the database.
  const fields = z.array(formFieldSchema).max(120).safeParse(form.fields ?? []);
  if (!fields.success) {
    console.error('[yourbiss] form definition could not be read', {
      form_id: form.id,
      issues: fields.error.issues.slice(0, 3).map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    });
    return (
      <>
        <PageHeader
          back={{ href: '/app/forms', label: 'Forms' }}
          title={form.title}
          description="This form is in the workspace, but its saved question list is not something this build can read."
        />
        <div className="ui-card max-w-[720px] px-4 py-4">
          <p className="text-[12.5px] leading-relaxed text-ink-soft">
            Nothing has been lost: the questions and every response are still stored. The document needs repairing where
            it was written before this screen will show it — saving from here would overwrite the questions this build
            could not read with an empty form.
          </p>
          <ButtonLink variant="secondary" href="/app/forms" className="mt-4">
            Back to Forms
          </ButtonLink>
        </div>
      </>
    );
  }

  const settings = formSettingsSchema.safeParse(form.settings ?? {});
  const theme = formThemeSchema.safeParse(form.theme ?? {});

  const document: FormDocument = {
    id: form.id,
    orgId: form.org_id,
    title: form.title,
    description: form.description ?? '',
    slug: form.slug,
    status: form.status,
    fields: fields.data as FormFieldDef[],
    settings: (settings.success ? (settings.data as FormSettings) : { ...FORM_SETTINGS_DEFAULT }),
    theme: (theme.success ? (theme.data as FormTheme) : { ...FORM_THEME_DEFAULT }),
    submissionCount: form.submission_count,
    publishedAt: form.published_at,
    updatedAt: form.updated_at,
  };

  const [submissions, privates, origin] = await Promise.all([
    listFormSubmissions(form.id),
    canAdmin ? getFormPrivates(form.id) : Promise.resolve(null),
    requestOrigin(),
  ]);

  return (
    <FormOverview
      form={document}
      privates={privates}
      submissions={submissions}
      orgSlug={workspace.org.slug}
      timezone={workspace.org.timezone}
      origin={origin}
      // Every member of the workspace may build and publish a form — that is what
      // `forms_write` in the schema allows. The one thing that takes that away is the
      // Forms app being switched off for the workspace, which the same policy checks,
      // so the builder is read-only in that case rather than quietly refusing saves.
      canManage={workspace.apps.forms === true}
      canAdmin={canAdmin}
    />
  );
}
