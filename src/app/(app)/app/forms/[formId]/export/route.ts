import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getForm, listFormSubmissions } from '@/lib/repo';
import { submissionsCsv } from '@/lib/forms/definition';
import { formFieldSchema, formSettingsSchema, type FormSettings } from '@/lib/forms/types';

/**
 * The responses of one form as a spreadsheet file.
 *
 * Read through the member's own session, like every other screen in here: the same
 * policy that lets someone see a response is the one that lets them export it, so a
 * member who cannot open the responses tab cannot get the file either.
 *
 * The header row comes from the form's own field list rather than from the rows, so
 * an answer that was left blank still occupies its column.
 */
export const dynamic = 'force-dynamic';

/** A cap on one download. Anything above it belongs in a scheduled export, not a browser tab. */
const MAX_ROWS = 20000;

function failure(status: number, message: string) {
  return new NextResponse(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ formId: string }> }) {
  const { formId } = await params;
  if (!z.string().uuid().safeParse(formId).success) return failure(404, 'No such form.');

  let form;
  try {
    form = await getForm(formId);
  } catch (error) {
    console.error('[yourbiss] response export could not read the form', {
      form_id: formId,
      error: error instanceof Error ? error.message : String(error),
    });
    return failure(500, 'The responses could not be read. Try again in a moment.');
  }

  // RLS answered with nothing: either the form is gone or it belongs to a workspace
  // this session is not a member of. One answer for both, so the id leaks nothing.
  if (!form) return failure(404, 'No such form.');

  const fields = formFieldSchema.array().max(120).safeParse(form.fields ?? []);
  const settings = formSettingsSchema.safeParse(form.settings ?? {});
  if (!fields.success || !settings.success) return failure(409, 'The saved definition of this form cannot be read.');

  let submissions;
  try {
    submissions = await listFormSubmissions(form.id, MAX_ROWS);
  } catch (error) {
    console.error('[yourbiss] response export could not read the responses', {
      form_id: form.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return failure(500, 'The responses could not be read. Try again in a moment.');
  }

  const csv = submissionsCsv(
    fields.data,
    settings.data as FormSettings,
    submissions.map((submission) => ({
      id: submission.id,
      created_at: submission.created_at,
      state: submission.state,
      submitter_email: submission.submitter_email,
      data: submission.data ?? {},
    })),
  );

  const name = `${form.slug.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60) || 'form'}-responses.csv`;

  return new NextResponse(csv, {
    headers: {
      // The byte-order mark is already in the body; Excel needs it to read UTF-8.
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'no-store',
      'x-yourbiss-truncated': submissions.length >= MAX_ROWS ? 'true' : 'false',
    },
  });
}
