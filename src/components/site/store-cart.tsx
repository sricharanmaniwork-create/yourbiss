'use client';

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { SiteTheme } from '@/lib/types';
import { formatAmount } from '@/lib/utils';
import type { StoreCartItem, StorefrontItems } from '@/lib/blocks/render';

/**
 * The cart a visitor orders from.
 *
 * It holds intentions, not prices. Every number here is worked out from the item list the
 * server read for this page — quantity times the price on the item, that line's own
 * tax percentage, one flat delivery fee — and the arithmetic mirrors, line for line, what
 * `store_place_order` does in the database, so the total a visitor sees and the total on
 * the document they are emailed cannot drift apart. What they send when they order is only
 * item ids and quantities. The shop decides the money.
 *
 * A basket lives in localStorage under the workspace's own key, so a visitor who closes the
 * tab and comes back tomorrow finds it waiting. It is read through React's external-store
 * hook instead of an effect: the server has no idea what this browser was last doing, so it
 * draws an empty basket and the stored one arrives on the client's first commit without a
 * hydration mismatch — and a second tab that empties the basket shows up here as well.
 */

interface Basket {
  [itemId: string]: number;
}

const EMPTY: Basket = {};
/** The `storage` event only reaches other tabs, so this one is told by hand. */
const CHANGED = 'yourbiss:basket';

/**
 * The store hook compares snapshots by identity, so parsing on every read would re-render
 * forever. One entry per key remembers the last parse and hands the same object back while
 * the stored string is unchanged.
 */
const cache = new Map<string, { raw: string | null; value: Basket }>();

function readBasket(key: string): Basket {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    // A browser that will not let us read is a browser with no basket.
    return EMPTY;
  }
  const last = cache.get(key);
  if (last && last.raw === raw) return last.value;
  const value = parseBasket(raw);
  cache.set(key, { raw, value });
  return value;
}

function parseBasket(raw: string | null): Basket {
  if (!raw) return EMPTY;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return EMPTY;
  const next: Basket = {};
  for (const [id, qty] of Object.entries(json as Record<string, unknown>)) {
    // Somebody who edited their own storage gets a clamped number rather than trust: the
    // item is re-read by the shop and a quantity it cannot hold is refused there.
    if (typeof qty === 'number' && Number.isFinite(qty) && qty > 0) next[id] = Math.min(9999, round2(qty));
  }
  return next;
}

function writeBasket(key: string, next: Basket): void {
  try {
    if (Object.keys(next).length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Same reason as the read: a browser that will not store a basket can still order.
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** The same two-decimal round the generated columns in 0012 do, applied line by line. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function StoreCart({
  storefront,
  theme,
  cta,
  columns,
}: {
  storefront: StorefrontItems;
  theme: SiteTheme;
  cta: string;
  columns: number;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<{ number: string; message: string } | null>(null);
  const storageKey = `yourbiss.cart.${storefront.orgId}`;
  const formRef = useRef<HTMLFormElement | null>(null);

  const subscribe = useCallback((onStoreChange: () => void) => {
    window.addEventListener('storage', onStoreChange);
    window.addEventListener(CHANGED, onStoreChange);
    return () => {
      window.removeEventListener('storage', onStoreChange);
      window.removeEventListener(CHANGED, onStoreChange);
    };
  }, []);
  const getBasket = useCallback(() => readBasket(storageKey), [storageKey]);
  const basket = useSyncExternalStore(subscribe, getBasket, () => EMPTY);

  const cart = useMemo(() => {
    const chosen = storefront.items.filter((item) => (basket[item.id] ?? 0) > 0);
    let subtotal = 0;
    let tax = 0;
    for (const item of chosen) {
      const qty = basket[item.id] ?? 0;
      subtotal += round2(qty * item.amount);
      tax += round2((qty * item.amount * item.taxPct) / 100);
    }
    const shipping = chosen.length === 0 ? 0 : storefront.shippingFlat;
    return { chosen, subtotal: round2(subtotal), tax: round2(tax), shipping, total: round2(subtotal + shipping + tax) };
  }, [basket, storefront.items, storefront.shippingFlat]);

  const { chosen } = cart;

  const money = (value: number) => formatAmount(value, storefront.currency, storefront.locale);

  const setQty = (item: StoreCartItem, qty: number) => {
    setError(null);
    setPlaced(null);
    const next: Basket = { ...basket };
    const wanted = Math.min(9999, Math.max(0, round2(Number.isFinite(qty) ? qty : 0)));
    if (wanted === 0) delete next[item.id];
    else next[item.id] = wanted;
    writeBasket(storageKey, next);
  };

  const submit = async (payload: { name: string; email: string; phone: string; address: string; notes: string }) => {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/store/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org: storefront.orgId,
          items: chosen.map((item) => ({ item_id: item.id, qty: basket[item.id] ?? 0 })),
          buyer: payload,
        }),
      });
      const answer = (await response.json().catch(() => null)) as {
        ok?: boolean;
        number?: string | null;
        message?: string;
        error?: string;
      } | null;

      if (!response.ok || !answer?.ok) {
        setError(answer?.error ?? 'Your order could not be placed. Please try again.');
        return;
      }

      writeBasket(storageKey, EMPTY);
      setPlaced({ number: String(answer.number ?? ''), message: answer.message ?? 'Your order is in.' });
      formRef.current?.reset();
    } catch {
      // The fetch itself failed: the network, not the shop. Say so and leave the basket.
      setError('Your order could not be sent. Check the connection and try again.');
    } finally {
      setPending(false);
    }
  };

  if (placed) {
    return (
      <div style={{ border: `1px solid ${theme.colors.border}`, borderRadius: theme.radius, padding: '22px', background: theme.colors.surface }}>
        <p style={{ margin: 0, fontSize: '18px', fontWeight: 700, fontFamily: theme.fonts.heading }}>{placed.number || 'Order received'}</p>
        <p style={{ margin: '8px 0 0', fontSize: '15px', lineHeight: 1.6, color: theme.colors.text }}>{placed.message}</p>
        <p style={{ margin: '14px 0 0', fontSize: '13.5px', color: theme.colors.muted }}>
          {placed.number ? 'Keep the number for your reference. ' : ''}Nothing was charged on this page — payment follows the note above.
        </p>
        <button
          type="button"
          onClick={() => setPlaced(null)}
          style={{ marginTop: '16px', padding: '9px 16px', borderRadius: theme.radius, border: `1px solid ${theme.colors.border}`, background: theme.colors.background, color: theme.colors.text, fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
        >
          Order something else
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: '20px', gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <div>
        <div style={{ display: 'grid', gap: '16px', gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${Math.floor(320 / columns)}px), 1fr))` }}>
          {storefront.items.map((item) => (
            <Card
              key={item.id}
              item={item}
              qty={basket[item.id] ?? 0}
              cta={cta}
              money={money}
              theme={theme}
              onAdd={() => setQty(item, (basket[item.id] ?? 0) + 1)}
              onSet={(qty) => setQty(item, qty)}
            />
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gap: '14px', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}>
        <section style={{ border: `1px solid ${theme.colors.border}`, borderRadius: theme.radius, background: theme.colors.surface, padding: '18px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '17px', fontFamily: theme.fonts.heading }}>Your basket</h3>
          {chosen.length === 0 ? (
            <p style={{ margin: 0, fontSize: '14px', color: theme.colors.muted }}>
              Nothing in it yet. Add something above and the delivery fee and tax are worked out here.
            </p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {chosen.map((item) => {
                const qty = basket[item.id] ?? 0;
                return (
                  <li key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 0', borderBottom: `1px solid ${theme.colors.border}` }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: '14px', fontWeight: 600 }}>{item.name}</span>
                      <span style={{ display: 'block', fontSize: '12.5px', color: theme.colors.muted }}>
                        {money(item.amount)} {item.taxPct > 0 ? `+ ${item.taxPct}% tax` : ''} each
                      </span>
                    </span>
                    <Stepper qty={qty} theme={theme} onChange={(next) => setQty(item, next)} />
                    <span style={{ width: '84px', textAlign: 'right', fontSize: '14px', fontWeight: 700 }}>
                      {money(round2(qty * item.amount))}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          <dl style={{ margin: '14px 0 0', fontSize: '14px', display: 'grid', gap: '6px' }}>
            <Line label="Items" value={money(cart.subtotal)} theme={theme} />
            <Line label="Delivery" value={cart.shipping === 0 ? 'Free' : money(cart.shipping)} theme={theme} />
            <Line label="Tax" value={money(cart.tax)} theme={theme} />
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginTop: '6px', paddingTop: '10px', borderTop: `2px solid ${theme.colors.border}`, fontSize: '16px', fontWeight: 700 }}>
              <dt>Total</dt>
              <dd>{money(cart.total)}</dd>
            </div>
          </dl>

          {chosen.length > 0 && (
            <p style={{ margin: '12px 0 0', fontSize: '12.5px', color: theme.colors.muted, lineHeight: 1.6 }}>
              A counted item is checked against the shelf when the order is placed, and held when the shop confirms it —
              so a basket is a request, not a reservation.
            </p>
          )}
        </section>

        <CheckoutForm
          formRef={formRef}
          theme={theme}
          note={storefront.checkoutNote}
          ready={chosen.length > 0}
          pending={pending}
          error={error}
          money={money}
          total={cart.total}
          onSubmit={submit}
        />
      </div>

      <noscript>
        <p style={{ margin: 0, fontSize: '14px' }}>
          Turning orders into a document needs JavaScript switched on. Tell us what you want another way — a phone call
          or an email is fine.
        </p>
      </noscript>
    </div>
  );
}

function Card({
  item,
  qty,
  cta,
  money,
  theme,
  onAdd,
  onSet,
}: {
  item: StoreCartItem;
  qty: number;
  cta: string;
  money: (value: number) => string;
  theme: SiteTheme;
  onAdd: () => void;
  onSet: (qty: number) => void;
}) {
  return (
    <article style={{ border: `1px solid ${theme.colors.border}`, borderRadius: theme.radius, overflow: 'hidden', background: theme.colors.surface, display: 'flex', flexDirection: 'column' }}>
      {item.image && (
        <img src={item.image} alt="" loading="lazy" decoding="async" style={{ display: 'block', width: '100%', aspectRatio: '4 / 3', objectFit: 'cover' }} />
      )}
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
        <p style={{ margin: 0, fontSize: '15.5px', fontWeight: 600 }}>{item.name}</p>
        {item.body && <p style={{ margin: 0, fontSize: '13.5px', lineHeight: 1.6, color: theme.colors.muted }}>{item.body}</p>}
        <p style={{ margin: 'auto 0 0', fontSize: '16px', fontWeight: 700, color: theme.colors.primary }}>
          {money(item.amount)}
          <span style={{ fontWeight: 400, fontSize: '12.5px', color: theme.colors.muted }}>
            {item.unit ? ` / ${item.unit}` : ''}
            {item.taxPct > 0 ? ` + ${item.taxPct}% tax` : ''}
          </span>
        </p>
        {qty > 0 ? (
          <Stepper qty={qty} theme={theme} onChange={onSet} />
        ) : (
          <button
            type="button"
            onClick={onAdd}
            style={{ padding: '10px 16px', borderRadius: theme.radius, border: '1px solid transparent', background: theme.colors.primary, color: '#FFFFFF', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
          >
            {cta}
          </button>
        )}
      </div>
    </article>
  );
}

function Stepper({ qty, theme, onChange }: { qty: number; theme: SiteTheme; onChange: (qty: number) => void }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', border: `1px solid ${theme.colors.border}`, borderRadius: theme.radius, overflow: 'hidden' }}>
      <button
        type="button"
        aria-label="One fewer"
        onClick={() => onChange(qty - 1)}
        style={{ width: '34px', height: '34px', border: 'none', background: theme.colors.background, color: theme.colors.text, fontSize: '16px', cursor: 'pointer' }}
      >
        −
      </button>
      <input
        type="number"
        min={0}
        max={9999}
        step="any"
        value={qty}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label="Quantity"
        style={{ width: '58px', height: '34px', border: 'none', borderInline: `1px solid ${theme.colors.border}`, textAlign: 'center', fontSize: '14px', background: theme.colors.surface, color: theme.colors.text }}
      />
      <button
        type="button"
        aria-label="One more"
        onClick={() => onChange(qty + 1)}
        style={{ width: '34px', height: '34px', border: 'none', background: theme.colors.background, color: theme.colors.text, fontSize: '16px', cursor: 'pointer' }}
      >
        +
      </button>
    </span>
  );
}

function Line({ label, value, theme }: { label: string; value: string; theme: SiteTheme }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
      <dt style={{ color: theme.colors.muted }}>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function CheckoutForm({
  formRef,
  theme,
  note,
  ready,
  pending,
  error,
  money,
  total,
  onSubmit,
}: {
  formRef: React.RefObject<HTMLFormElement | null>;
  theme: SiteTheme;
  note: string;
  ready: boolean;
  pending: boolean;
  error: string | null;
  money: (value: number) => string;
  total: number;
  onSubmit: (buyer: { name: string; email: string; phone: string; address: string; notes: string }) => Promise<void>;
}) {
  const field = {
    width: '100%',
    padding: '11px 14px',
    borderRadius: theme.radius,
    border: `1px solid ${theme.colors.border}`,
    fontSize: '15px',
    color: theme.colors.text,
    background: theme.colors.surface,
  } as const;
  const labelStyle = { display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' } as const;

  return (
    <section style={{ border: `1px solid ${theme.colors.border}`, borderRadius: theme.radius, background: theme.colors.surface, padding: '18px' }}>
      <h3 style={{ margin: '0 0 12px', fontSize: '17px', fontFamily: theme.fonts.heading }}>Where it goes</h3>

      {note && (
        <p style={{ margin: '0 0 14px', fontSize: '13.5px', lineHeight: 1.6, color: theme.colors.text, background: theme.colors.background, border: `1px solid ${theme.colors.border}`, borderRadius: theme.radius, padding: '11px 13px' }}>
          {note}
        </p>
      )}

      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void onSubmit({
            name: String(data.get('name') ?? ''),
            email: String(data.get('email') ?? ''),
            phone: String(data.get('phone') ?? ''),
            address: String(data.get('address') ?? ''),
            notes: String(data.get('notes') ?? ''),
          });
        }}
        style={{ display: 'grid', gap: '12px' }}
      >
        {/* A field no human is shown. The payload is built by hand above and never reads
            it, so only a script that posts the whole DOM form back carries one — and the
            shop refuses it without telling the bot it was caught. */}
        <input type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px' }} />

        <label>
          <span style={labelStyle}>Name</span>
          <input name="name" required maxLength={140} autoComplete="name" placeholder="Who the parcel is for" style={field} />
        </label>
        <label>
          <span style={labelStyle}>Email</span>
          <input name="email" type="email" required maxLength={254} autoComplete="email" placeholder="you@example.com" style={field} />
        </label>
        <label>
          <span style={labelStyle}>Phone</span>
          <input name="phone" maxLength={40} autoComplete="tel" placeholder="For the delivery, if they need it" style={field} />
        </label>
        <label>
          <span style={labelStyle}>Address</span>
          <textarea name="address" required maxLength={400} rows={3} autoComplete="street-address" placeholder="Flat, street, city, postcode" style={field} />
        </label>
        <label>
          <span style={labelStyle}>Anything we should know</span>
          <textarea name="notes" maxLength={1000} rows={2} placeholder="Optional" style={field} />
        </label>

        <div aria-live="polite">
          {error && (
            <p role="alert" style={{ margin: 0, fontSize: '13.5px', lineHeight: 1.6, color: '#B3261E' }}>
              {error}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={!ready || pending}
          style={{ padding: '12px 18px', borderRadius: theme.radius, border: '1px solid transparent', background: theme.colors.primary, color: '#FFFFFF', fontSize: '15px', fontWeight: 700, cursor: ready && !pending ? 'pointer' : 'not-allowed', opacity: ready && !pending ? 1 : 0.55 }}
        >
          {pending ? 'Sending…' : `Place the order · ${money(total)}`}
        </button>

        <p style={{ margin: 0, fontSize: '12.5px', lineHeight: 1.6, color: theme.colors.muted }}>
          Nothing is charged here. The order is written, your shop is told, and the money follows however the note above
          says.
        </p>
      </form>
    </section>
  );
}
