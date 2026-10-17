/**
 * Where a workspace's own address is shared — a published site page, a form link, a
 * booking link — the visitor has no dashboard to fall back to. The root 404 sends signed-in
 * people home; this one only admits the link is dead. No button: the browser back arrow is
 * the only relevant action, and a "Yourbiss" sign-up pitch would be about the wrong thing.
 */
export default function PublicNotFound() {
  return (
    <main className="min-h-screen bg-[#f2f4f7] px-4 py-10">
      <div className="mx-auto w-full max-w-[520px] rounded-xl border border-[#e4e8ee] bg-white px-6 py-10 text-center">
        <p className="text-[38px] font-semibold leading-none text-[#2e6be6]">404</p>
        <h1 className="mt-3 text-[17px] font-semibold text-[#111827]">This link does not lead anywhere</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-[#475467]">
          The page was unpublished, the form or service was removed, or the address was mistyped. Whoever sent you the
          link can check that it is still live.
        </p>
      </div>
    </main>
  );
}
