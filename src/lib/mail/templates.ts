import 'server-only';

import { escapeHtml } from '@/lib/utils';

/**
 * Outgoing HTML. Tables and inline styles because that is what mail clients
 * actually agree on; a stylesheet link would simply be ignored by most of them.
 */

interface ShellOptions {
  preheader: string;
  heading: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaHref?: string;
  metaLines?: { label: string; value: string }[];
  footer: string;
  accent: string;
  brand: string;
}

/**
 * The letter's frame. Exported for `overrides.ts`, which puts a workspace's own wording
 * inside the same card rather than handing out a bare fragment a mail client would restyle.
 */
export function shell(o: ShellOptions): string {
  const meta =
    o.metaLines && o.metaLines.length > 0
      ? `<tr><td style="padding:20px 28px 0">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
              ${o.metaLines
                .map(
                  (m) => `<tr>
                    <td style="padding:8px 0;border-bottom:1px solid #EEF0F3;font:13px/1.5 Arial,Helvetica,sans-serif;color:#6B7280;width:38%">${escapeHtml(m.label)}</td>
                    <td style="padding:8px 0;border-bottom:1px solid #EEF0F3;font:13px/1.5 Arial,Helvetica,sans-serif;color:#111827;font-weight:bold">${escapeHtml(m.value)}</td>
                  </tr>`,
                )
                .join('')}
            </table>
          </td></tr>`
      : '';

  const cta =
    o.ctaLabel && o.ctaHref
      ? `<tr><td style="padding:24px 28px 8px">
            <a href="${escapeHtml(o.ctaHref)}" style="display:inline-block;background:${escapeHtml(o.accent)};color:#FFFFFF;font:14px/1 Arial,Helvetica,sans-serif;font-weight:bold;text-decoration:none;padding:12px 22px;border-radius:6px">${escapeHtml(o.ctaLabel)}</a>
          </td></tr>`
      : '';

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-preheader" content="${escapeHtml(o.preheader)}"><title>${escapeHtml(o.heading)}</title></head>
<body style="margin:0;padding:0;background:#F4F5F7">
  <span style="display:none;font-size:1px;color:#F4F5F7;line-height:1px;max-height:0;overflow:hidden">${escapeHtml(o.preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#F4F5F7;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:600px;background:#FFFFFF;border:1px solid #E5E7EB;border-radius:10px;overflow:hidden">
        <tr><td style="padding:20px 28px;border-bottom:1px solid #EEF0F3">
          <span style="font:13px/1 Arial,Helvetica,sans-serif;color:#6B7280;letter-spacing:1px;text-transform:uppercase">${escapeHtml(o.brand)}</span>
        </td></tr>
        <tr><td style="padding:24px 28px 6px">
          <h1 style="margin:0;font:21px/1.3 Arial,Helvetica,sans-serif;color:#111827">${escapeHtml(o.heading)}</h1>
        </td></tr>
        <tr><td style="padding:12px 28px 0;font:15px/1.6 Arial,Helvetica,sans-serif;color:#374151">${o.bodyHtml}</td></tr>
        ${meta}
        ${cta}
        <tr><td style="padding:26px 28px;border-top:1px solid #EEF0F3;background:#FAFBFC">
          <div style="font:12px/1.6 Arial,Helvetica,sans-serif;color:#6B7280">${escapeHtml(o.footer)}</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

export interface Base {
  brand: string;
  footer: string;
  accent?: string;
}

/**
 * The brand line and footer every template repeats. Built from the workspace row
 * so a booking confirmation from a dental practice reads as that practice, not
 * as Yourbiss.
 */
export function mailBase(orgName: string): Base {
  return {
    brand: orgName,
    accent: '#2E6BE6',
    footer: `Sent by ${orgName} on Yourbiss. If this was not you, no action is needed.`,
  };
}

export function bookingConfirmation(
  base: Base,
  input: {
    customerName: string;
    serviceName: string;
    staffName: string;
    when: string;
    timeZone: string;
    durationMin: number;
    code: string;
    manageUrl: string;
    price?: string;
    location?: string;
  },
): RenderedMail {
  const subject = `Booking confirmed: ${input.serviceName} on ${input.when}`;
  const html = shell({
    brand: base.brand,
    accent: base.accent ?? '#2E6BE6',
    preheader: `${input.serviceName} with ${input.staffName}, ${input.when}`,
    heading: 'Your booking is confirmed',
    bodyHtml: `<p>Hi ${escapeHtml(input.customerName)},</p>
      <p>This confirms your appointment. A calendar-style summary is below, and you can move or cancel it any time using the reference code.</p>`,
    metaLines: [
      { label: 'Service', value: input.serviceName },
      { label: 'With', value: input.staffName },
      { label: 'When', value: `${input.when} (${input.timeZone})` },
      { label: 'Duration', value: `${input.durationMin} minutes` },
      ...(input.location ? [{ label: 'Where', value: input.location }] : []),
      ...(input.price ? [{ label: 'Fee', value: input.price }] : []),
      { label: 'Reference', value: input.code },
    ],
    ctaLabel: 'Manage this booking',
    ctaHref: input.manageUrl,
    footer: base.footer,
  });

  return {
    subject,
    html,
    text: `Hi ${input.customerName},\n\nYour booking is confirmed.\n\nService:   ${input.serviceName}\nWith:      ${input.staffName}\nWhen:      ${input.when} (${input.timeZone})\nDuration:  ${input.durationMin} minutes\nReference: ${input.code}\n\nManage it here: ${input.manageUrl}\n\n${base.footer}`,
  };
}

export function bookingReminder(
  base: Base,
  input: { customerName: string; serviceName: string; staffName: string; when: string; timeZone: string; code: string; manageUrl: string },
): RenderedMail {
  const subject = `Reminder: ${input.serviceName} on ${input.when}`;
  return {
    subject,
    html: shell({
      brand: base.brand,
      accent: base.accent ?? '#2E6BE6',
      preheader: `See you soon for ${input.serviceName}`,
      heading: 'A reminder about your appointment',
      bodyHtml: `<p>Hi ${escapeHtml(input.customerName)},</p>
        <p>This is a friendly reminder for your upcoming appointment. Reply to the business directly if you need to change it.</p>`,
      metaLines: [
        { label: 'Service', value: input.serviceName },
        { label: 'With', value: input.staffName },
        { label: 'When', value: `${input.when} (${input.timeZone})` },
        { label: 'Reference', value: input.code },
      ],
      ctaLabel: 'View booking details',
      ctaHref: input.manageUrl,
      footer: base.footer,
    }),
    text: `Hi ${input.customerName},\n\nReminder: ${input.serviceName} with ${input.staffName} on ${input.when} (${input.timeZone}).\nReference: ${input.code}\n\n${input.manageUrl}`,
  };
}

export function bookingCancelled(
  base: Base,
  input: { customerName: string; serviceName: string; when: string; code: string; rebookUrl: string; byCustomer: boolean },
): RenderedMail {
  const subject = input.byCustomer ? `Cancellation received: ${input.serviceName}` : `Your booking was cancelled: ${input.serviceName}`;
  return {
    subject,
    html: shell({
      brand: base.brand,
      accent: base.accent ?? '#2E6BE6',
      preheader: `${input.serviceName} on ${input.when} is cancelled`,
      heading: input.byCustomer ? 'Your cancellation is confirmed' : 'This booking has been cancelled',
      bodyHtml: `<p>Hi ${escapeHtml(input.customerName)},</p>
        <p>${input.byCustomer
          ? 'The appointment has been cancelled and the time slot is released.'
          : 'The business had to cancel this appointment. We are sorry for the trouble — you can pick another time below.'}</p>`,
      metaLines: [
        { label: 'Service', value: input.serviceName },
        { label: 'Was booked for', value: input.when },
        { label: 'Reference', value: input.code },
      ],
      ctaLabel: 'Book another time',
      ctaHref: input.rebookUrl,
      footer: base.footer,
    }),
    text: `Hi ${input.customerName},\n\n${input.serviceName} on ${input.when} (reference ${input.code}) has been cancelled.\n\nBook another time: ${input.rebookUrl}`,
  };
}

export function bookingRescheduled(
  base: Base,
  input: {
    customerName: string;
    serviceName: string;
    staffName: string;
    /**
     * Only stated when the caller actually holds it. `reschedule_booking` writes the new
     * time over the old one and keeps no history row, so the queue normally cannot know
     * what was replaced — and a letter that guesses at the previous time is worse than one
     * that says nothing about it.
     */
    oldWhen?: string;
    when: string;
    timeZone: string;
    code: string;
    manageUrl: string;
  },
): RenderedMail {
  const subject = `Rescheduled: ${input.serviceName} now on ${input.when}`;
  return {
    subject,
    html: shell({
      brand: base.brand,
      accent: base.accent ?? '#2E6BE6',
      preheader: `${input.serviceName} moved to ${input.when}`,
      heading: 'Your appointment has moved',
      bodyHtml: `<p>Hi ${escapeHtml(input.customerName)},</p>
        <p>The time below replaces your previous appointment. Nothing else about the booking has changed.</p>`,
      metaLines: [
        { label: 'Service', value: input.serviceName },
        { label: 'With', value: input.staffName },
        { label: 'New time', value: `${input.when} (${input.timeZone})` },
        ...(input.oldWhen ? [{ label: 'Previous time', value: input.oldWhen }] : []),
        { label: 'Reference', value: input.code },
      ],
      ctaLabel: 'Manage this booking',
      ctaHref: input.manageUrl,
      footer: base.footer,
    }),
    text: `Hi ${input.customerName},\n\n${input.serviceName} with ${input.staffName} has moved to ${input.when} (${input.timeZone}).${
      input.oldWhen ? ` It replaces ${input.oldWhen}.` : ''
    }\nReference: ${input.code}\n\n${input.manageUrl}`,
  };
}

export function teamNewBooking(
  base: Base,
  input: { staffName: string; serviceName: string; customerName: string; customerEmail: string; customerPhone?: string | null; when: string; timeZone: string; notes?: string | null; code: string; manageUrl: string },
): RenderedMail {
  const subject = `New booking: ${input.serviceName} — ${input.customerName}`;
  return {
    subject,
    html: shell({
      brand: base.brand,
      accent: base.accent ?? '#2E6BE6',
      preheader: `${input.customerName} booked ${input.serviceName}`,
      heading: 'A new booking came in',
      bodyHtml: `<p>${escapeHtml(input.customerName)} booked <strong>${escapeHtml(input.serviceName)}</strong> with ${escapeHtml(input.staffName)}.</p>${
        input.notes ? `<p style="margin-top:14px;padding:10px 12px;background:#F7F8FA;border-left:3px solid #E5E7EB">${escapeHtml(input.notes)}</p>` : ''
      }`,
      metaLines: [
        { label: 'Customer', value: input.customerName },
        { label: 'Email', value: input.customerEmail },
        ...(input.customerPhone ? [{ label: 'Phone', value: input.customerPhone }] : []),
        { label: 'When', value: `${input.when} (${input.timeZone})` },
        { label: 'Reference', value: input.code },
      ],
      ctaLabel: 'Open in Yourbiss',
      ctaHref: input.manageUrl,
      footer: base.footer,
    }),
    text: `New booking\n\nCustomer: ${input.customerName} <${input.customerEmail}>\nService:  ${input.serviceName}\nWith:     ${input.staffName}\nWhen:     ${input.when} (${input.timeZone})\nRef:      ${input.code}\n\n${input.manageUrl}`,
  };
}

export function formResponseMail(
  base: Base,
  input: { formTitle: string; answers: { label: string; value: string }[]; submitterEmail?: string | null; orgName: string },
): RenderedMail {
  const subject = `New response: ${input.formTitle}`;
  return {
    subject,
    html: shell({
      brand: base.brand,
      accent: base.accent ?? '#2E6BE6',
      preheader: `Someone submitted ${input.formTitle}`,
      heading: `New response to "${input.formTitle}"`,
      bodyHtml: '<p>The answers are listed in the order the questions were asked.</p>',
      metaLines: input.answers.map((a) => ({ label: a.label, value: a.value || '—' })),
      footer: `${input.orgName} · sent by Yourbiss`,
    }),
    text: `New response to ${input.formTitle}\n\n${input.answers.map((a) => `${a.label}: ${a.value || '—'}`).join('\n')}`,
  };
}

export function inviteMail(base: Base, input: { inviterName: string; orgName: string; acceptUrl: string; role: string }): RenderedMail {
  const subject = `${input.inviterName} invited you to ${input.orgName} on Yourbiss`;
  return {
    subject,
    html: shell({
      brand: base.brand,
      accent: base.accent ?? '#2E6BE6',
      preheader: `Join ${input.orgName} on Yourbiss`,
      heading: `Join ${input.orgName}`,
      bodyHtml: `<p>${escapeHtml(input.inviterName)} invited you to work in <strong>${escapeHtml(input.orgName)}</strong> as ${escapeHtml(input.role)}.</p>
        <p>Accepting the invitation adds you to the workspace. Invitations expire after seven days.</p>`,
      ctaLabel: 'Accept invitation',
      ctaHref: input.acceptUrl,
      footer: base.footer,
    }),
    text: `${input.inviterName} invited you to ${input.orgName} on Yourbiss as ${input.role}.\n\nAccept: ${input.acceptUrl}`,
  };
}

/**
 * The buyer's copy of their own order.
 *
 * The lines are exactly what `store_place_order` wrote, which is the point: this letter
 * is the receipt, and a receipt that re-priced the basket from today's prices would
 * contradict the document it is describing. Nothing here is a promise about payment —
 * no gateway takes money on this site, so the letter says how the shop will be in touch
 * instead of showing a button that would lead nowhere.
 */
export function storeOrderConfirmation(
  base: Base,
  input: {
    customerName: string;
    number: string;
    placedAt: string;
    lines: { label: string; amount: string }[];
    subtotal: string;
    shipping: string;
    taxTotal: string;
    total: string;
    address: string;
    note?: string;
    instructions?: string;
  },
): RenderedMail {
  const subject = `Your order ${input.number}`;
  const metaLines = [
    { label: 'Reference', value: input.number },
    { label: 'Placed', value: input.placedAt },
    ...input.lines.map((line) => ({ label: line.label, value: line.amount })),
    { label: 'Items', value: input.subtotal },
    { label: 'Delivery', value: input.shipping },
    { label: 'Tax', value: input.taxTotal },
    { label: 'Total', value: input.total },
    { label: 'Deliver to', value: input.address },
  ];

  return {
    subject,
    html: shell({
      brand: base.brand,
      accent: base.accent ?? '#2E6BE6',
      preheader: `Order ${input.number} — ${input.total}`,
      heading: `Thank you, ${input.customerName}`,
      bodyHtml: `<p>We have your order. The shop will confirm it and be in touch about delivery.</p>
        ${input.note ? `<p>You told them: <em>${escapeHtml(input.note)}</em></p>` : ''}
        ${input.instructions ? `<p>${escapeHtml(input.instructions)}</p>` : ''}`,
      metaLines,
      footer: base.footer,
    }),
    text: `Thank you, ${input.customerName}.\n\nWe have your order and the shop will confirm it.\n\n` +
      `Reference: ${input.number}\nPlaced: ${input.placedAt}\n\n` +
      input.lines.map((line) => `${line.label.padEnd(28)} ${line.amount}`).join('\n') +
      `\n\nItems:    ${input.subtotal}\nDelivery: ${input.shipping}\nTax:      ${input.taxTotal}\nTotal:    ${input.total}\n\nDeliver to: ${input.address}` +
      (input.note ? `\nYour note: ${input.note}` : '') +
      (input.instructions ? `\n\n${input.instructions}` : ''),
  };
}

/** The workspace's own copy, so a new order reaches somebody while it is still `placed`. */
export function teamNewOrder(
  base: Base,
  input: {
    orgName: string;
    number: string;
    customerName: string;
    customerEmail: string;
    total: string;
    lines: string;
    address: string;
    orderUrl: string;
  },
): RenderedMail {
  const subject = `New order ${input.number} — ${input.total}`;
  return {
    subject,
    html: shell({
      brand: base.brand,
      accent: base.accent ?? '#2E6BE6',
      preheader: `${input.customerName} ordered ${input.number}`,
      heading: 'A new order arrived',
      bodyHtml: '<p>Confirm it to take the goods off the shelf, or cancel it if something is unavailable.</p>',
      metaLines: [
        { label: 'Reference', value: input.number },
        { label: 'Buyer', value: `${input.customerName} (${input.customerEmail})` },
        { label: 'Lines', value: input.lines },
        { label: 'Total', value: input.total },
        { label: 'Deliver to', value: input.address },
      ],
      ctaLabel: 'Open the order',
      ctaHref: input.orderUrl,
      footer: `${input.orgName} · sent by Yourbiss`,
    }),
    text: `New order ${input.number} from ${input.customerName} (${input.customerEmail}).\n\n${input.lines}\nTotal: ${input.total}\nDeliver to: ${input.address}\n\nOpen it: ${input.orderUrl}`,
  };
}

/**
 * A letter an automation wrote.
 *
 * The subject and the body are the workspace's own words, with `{{tokens}}` already
 * filled in, so this is the only template that takes text rather than fields — and the
 * only care it needs is that somebody's sentence cannot end the HTML. Paragraph breaks
 * become paragraphs, nothing else is interpreted.
 */
export function automationLetter(
  base: Base,
  input: { subject: string; body: string; event: string; metaLines?: { label: string; value: string }[] },
): RenderedMail {
  const paragraphs = input.body
    .split(/\r?\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk !== '')
    .map((chunk) => `<p style="margin:0 0 14px">${escapeHtml(chunk).replace(/\r?\n/g, '<br>')}</p>`)
    .join('');

  return {
    subject: input.subject,
    html: shell({
      brand: base.brand,
      accent: base.accent ?? '#2E6BE6',
      preheader: input.subject,
      heading: input.subject,
      bodyHtml: paragraphs || '<p style="margin:0">No message was written for this letter.</p>',
      metaLines: [{ label: 'Because', value: input.event }, ...(input.metaLines ?? [])],
      footer: base.footer,
    }),
    text: `${input.subject}\n\n${input.body}\n\nBecause: ${input.event}\n\n${base.footer}`,
  };
}
