/**
 * A settings page a plain member cannot open. Redirecting would loop, because
 * `/app/settings/profile` is also under this layout — so the page says what is
 * missing and points at the one screen they do own.
 */
export function AdminOnly({ action }: { action: string }) {
  return (
    <div className="ui-card max-w-[560px] px-6 py-7">
      <h2 className="text-[15px] font-semibold">Workspace owners and admins only</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">
        {action} changes settings every customer sees or every teammate is bound by, so it is limited to the owner and
        admins. Ask one of them, or update your own details from <strong>Your profile</strong>.
      </p>
    </div>
  );
}
