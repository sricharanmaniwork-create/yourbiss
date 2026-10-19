import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PublicForm } from '@/components/forms/public-form';
import { isFormClosed } from '@/lib/forms/definition';
import { findFormBySlug, type PublicForm as FormShape } from '@/lib/forms/public';
import { dateInZone } from '@/lib/utils';

/**
 * The address a workspace shares: `/f/<workspace>/<form>`.
 *
 * Dynamic because the answer is whatever the owner published a moment ago, and
 * because a form past its closing time must stop taking answers on the next
 * refresh rather than after the next deploy.
 */
export const dynamic = 'force-dynamic';

interface Params {
  orgSlug: string;
  formSlug: string;
}

async function load(params: Params): Promise<FormShape | null> {
  return findFormBySlug(params.orgSlug, params.formSlug);
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const form = await load(await params);
  if (!form) return { title: 'Form not found' };

  return {
    title: form.title,
    description: form.description ?? undefined,
    // Not indexable on purpose: a link that ranks is a link a bot finds, and a
    // form that records answers is not content anyone is searching for.
    robots: { index: false, follow: false },
  };
}

export default async function PublicFormPage({ params }: { params: Promise<Params> }) {
  const form = await load(await params);
  if (!form) notFound();

  if (isFormClosed(form.settings.close_at)) return <Closed form={form} />;

  return (
    <main className="min-h-screen bg-[#f2f4f7] px-4 py-10">
      <div className="mx-auto w-full max-w-[680px]">
        <p className="mb-3 text-[12.5px] font-medium text-[#667085]">{form.orgName}</p>
        <PublicForm
          formId={form.id}
          title={form.title}
          description={form.description}
          fields={form.fields}
          settings={form.settings}
          theme={form.theme}
          today={dateInZone(new Date(), form.timezone)}
        />
      </div>
    </main>
  );
}

/**
 * Past `close_at` the questions are still readable, because someone may have the
 * link in a mail and wants to know what they missed — only the answers are closed,
 * and the submit route refuses them as well.
 */
function Closed({ form }: { form: FormShape }) {
  return (
    <main className="min-h-screen bg-[#f2f4f7] px-4 py-10">
      <div className="mx-auto w-full max-w-[520px] rounded-xl border border-[#e4e8ee] bg-white px-6 py-10 text-center">
        <p className="text-[12.5px] font-medium text-[#667085]">{form.orgName}</p>
        <h1 className="mt-2 text-[20px] font-semibold text-[#111827]">{form.title}</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-[#475467]">
          This form is closed to new responses.
          {form.settings.close_at ? ` It stopped on ${new Date(form.settings.close_at).toLocaleDateString('en-GB', { dateStyle: 'medium' })}.` : ''}
        </p>
      </div>
    </main>
  );
}
