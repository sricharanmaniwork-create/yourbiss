import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PublicForm } from '@/components/forms/public-form';
import { isFormClosed } from '@/lib/forms/definition';
import { findFormById } from '@/lib/forms/public';
import { dateInZone } from '@/lib/utils';

/**
 * The frame a published site puts a form in — `/embed/form/<id>`.
 *
 * It is a separate address from the shared link because the two are asked for
 * different things: a frame has to fit inside someone else's page, so it carries no
 * card and no page background, and it is addressed by id so the block can point at
 * a form without knowing the workspace's slug.
 *
 * Same-origin by construction, which is what lets the submit route insist on it and
 * still accept a post from the frame.
 */
export const dynamic = 'force-dynamic';

interface Params {
  formId: string;
}

export const metadata: Metadata = {
  // The frame is addressed by id, so this page cannot name itself without reading
  // the form twice; the block sets the frame's accessible title instead.
  title: 'Form',
  robots: { index: false, follow: false },
};

export default async function FormEmbedPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ title?: string }>;
}) {
  const { formId } = await params;
  const query = await searchParams;

  // The block asks for no title only when it is showing the form's name itself, so
  // exactly one heading reaches the visitor either way.
  const showTitle = query.title !== 'off';

  const form = await findFormById(formId);
  if (!form) notFound();

  if (isFormClosed(form.settings.close_at)) {
    return (
      <div className="yb-form">
        <p className="yb-form-notice">This form is closed to new responses.</p>
      </div>
    );
  }

  return (
    <PublicForm
      variant="embed"
      formId={form.id}
      title={showTitle ? form.title : ''}
      description={form.description}
      fields={form.fields}
      settings={form.settings}
      theme={form.theme}
      today={dateInZone(new Date(), form.timezone)}
    />
  );
}
