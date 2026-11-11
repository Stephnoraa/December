import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  SocketCommand,
  SocketEvent,
  type CustomerSessionDto,
  type OrderDto,
  type TableLandingDto,
} from '@app/shared';
import { ApiError, api, errorMessage, get, post } from '../../lib/api';
import { useCart } from '../../lib/cart';
import { resetSocket, useSocket } from '../../lib/socket';
import {
  Alert,
  Button,
  CenteredMessage,
  cx,
  MenuSkeleton,
  Money,
  Sheet,
} from '../../components/ui';
import { MenuView } from './MenuView';
import { TabView } from './TabView';
import { PayButton } from './PaySheet';

type Tab = 'menu' | 'table';

function Header({
  venue,
  table,
}: {
  venue: TableLandingDto['venue'];
  table: TableLandingDto['table'];
}) {
  return (
    <header className="flex items-center gap-3 bg-brand-700 px-4 pb-4 pt-[calc(1rem+env(safe-area-inset-top))] text-white">
      {venue.logoUrl ? (
        <img src={venue.logoUrl} alt="" className="h-12 w-12 rounded-2xl bg-white object-cover" />
      ) : (
        <div
          className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 text-xl font-bold"
          aria-hidden="true"
        >
          {venue.name.slice(0, 1)}
        </div>
      )}
      <div className="min-w-0">
        <h1 className="truncate text-xl font-bold">{venue.name}</h1>
        <p className="text-sm text-white/80">
          Table {table.label}
          {table.area ? ` · ${table.area}` : ''}
        </p>
      </div>
    </header>
  );
}

export function TablePage() {
  const { slug = '', token = '' } = useParams();
  const qc = useQueryClient();
  const landingKey = ['landing', slug, token];
  const landing = useQuery({
    queryKey: landingKey,
    queryFn: () => get<TableLandingDto>(`/v1/public/t/${slug}/${token}`),
    retry: 1,
  });
  const open = landing.data?.open ?? false;
  const joined = landing.data?.joined ?? false;

  const join = useMutation({
    mutationFn: () => post<{ tableSessionId: string }>(`/v1/public/t/${slug}/${token}/join`),
    onSuccess: async () => {
      resetSocket(); // reconnect with the new customer cookie
      await qc.invalidateQueries({ queryKey: landingKey });
    },
  });
  const joinRef = useRef(join);
  joinRef.current = join;
  useEffect(() => {
    if (open && !joined && joinRef.current.isIdle) joinRef.current.mutate();
  }, [open, joined]);

  const session = useQuery({
    queryKey: ['session'],
    queryFn: () => get<CustomerSessionDto>('/v1/public/session'),
    enabled: joined,
    refetchInterval: 60_000,
  });

  const onEvent = useCallback(
    (event: SocketEvent, payload: { version?: number }) => {
      if (
        event === SocketEvent.TABLE_SESSION_OPENED ||
        event === SocketEvent.TABLE_SESSION_CLOSED
      ) {
        void qc.invalidateQueries({ queryKey: landingKey });
        void qc.invalidateQueries({ queryKey: ['session'] });
        return;
      }
      if (event === SocketEvent.MENU_CHANGED) {
        void qc.invalidateQueries({ queryKey: landingKey });
        void qc.invalidateQueries({ queryKey: ['session'] });
        return;
      }
      const current = qc.getQueryData<CustomerSessionDto>(['session']);
      // Ignore stale notifications: the cached tab is already at least this new.
      if (
        event === SocketEvent.TAB_UPDATED &&
        current &&
        payload.version !== undefined &&
        payload.version <= current.tab.version
      )
        return;
      void qc.invalidateQueries({ queryKey: ['session'] });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc, slug, token],
  );
  useSocket(
    [
      SocketEvent.TABLE_SESSION_OPENED,
      SocketEvent.TABLE_SESSION_CLOSED,
      SocketEvent.MENU_CHANGED,
      SocketEvent.TAB_UPDATED,
      SocketEvent.ORDER_ITEM_UPDATED,
      SocketEvent.ORDER_UPDATED,
      SocketEvent.PAYMENT_UPDATED,
      SocketEvent.SERVICE_REQUEST_CHANGED,
    ],
    onEvent,
    (socket) => {
      socket.emit(SocketCommand.SUBSCRIBE_TABLE, { venueSlug: slug, tableToken: token });
      void qc.invalidateQueries({ queryKey: landingKey });
      void qc.invalidateQueries({ queryKey: ['session'] });
    },
    `${slug}/${token}`,
  );

  if (landing.isLoading) return <MenuSkeleton />;
  if (landing.error) {
    const err = landing.error;
    if (err instanceof ApiError && err.code === 'VENUE_SUSPENDED') {
      const name = (err.details as { venueName?: string } | undefined)?.venueName;
      return (
        <CenteredMessage title="Ordering is unavailable right now" icon="🙏">
          {name
            ? `${name} isn't taking orders through this page at the moment.`
            : 'This venue isn’t taking orders here at the moment.'}{' '}
          Please order with your waiter.
        </CenteredMessage>
      );
    }
    if (err instanceof ApiError && err.code === 'INVALID_TABLE_TOKEN') {
      return (
        <CenteredMessage title="This QR code has expired" icon="🔄">
          Please ask your waiter for the current code for your table.
        </CenteredMessage>
      );
    }
    return (
      <CenteredMessage title="Can't load the menu" icon="📶">
        {errorMessage(err)}
        <div className="mt-4">
          <Button onClick={() => void landing.refetch()}>Try again</Button>
        </div>
      </CenteredMessage>
    );
  }
  const data = landing.data!;
  return (
    <div className="min-h-screen">
      <Header venue={data.venue} table={data.table} />
      {open && joined && session.data ? (
        <OrderingView session={session.data} slug={slug} token={token} />
      ) : (
        <ReadOnlyView
          landing={data}
          slug={slug}
          token={token}
          joining={open && (join.isPending || session.isLoading)}
          joinError={join.error}
        />
      )}
    </div>
  );
}

function CallWaiterButton({
  slug,
  token,
  className,
}: {
  slug: string;
  token: string;
  className?: string;
}) {
  const call = useMutation({ mutationFn: () => post(`/v1/public/t/${slug}/${token}/call-waiter`) });
  return (
    <Button
      variant="secondary"
      className={className}
      busy={call.isPending}
      disabled={call.isSuccess}
      onClick={() => call.mutate()}
    >
      {call.isSuccess ? '✓ Waiter called' : '🙋 Call waiter'}
    </Button>
  );
}

function ReadOnlyView({
  landing,
  slug,
  token,
  joining,
  joinError,
}: {
  landing: TableLandingDto;
  slug: string;
  token: string;
  joining: boolean;
  joinError: unknown;
}) {
  return (
    <main className="mx-auto max-w-lg px-4 pb-32">
      {joining ? (
        <div className="mt-4">
          <Alert tone="blue">Your table is open. Getting your order ready…</Alert>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <Alert tone="amber">
            <strong className="block text-base">Ask your waiter to open this table</strong>
            You can browse the menu now. Ordering unlocks here as soon as your table is opened.
          </Alert>
          {Boolean(joinError) && <Alert>{errorMessage(joinError)}</Alert>}
        </div>
      )}
      <MenuView menu={landing.menu} canOrder={false} onAdd={() => undefined} />
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto max-w-lg">
          <CallWaiterButton slug={slug} token={token} className="w-full" />
        </div>
      </div>
    </main>
  );
}

function OrderingView({
  session,
  slug,
  token,
}: {
  session: CustomerSessionDto;
  slug: string;
  token: string;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('menu');
  const [cartOpen, setCartOpen] = useState(false);
  const cart = useCart(session.tableSession.id);
  const closed = session.tableSession.status === 'CLOSED';
  const [submitKey, setSubmitKey] = useState<string | null>(null);
  const [lastOrder, setLastOrder] = useState<OrderDto | null>(null);

  const submit = useMutation({
    mutationFn: (key: string) =>
      api<OrderDto>('/v1/public/session/orders', {
        method: 'POST',
        idempotencyKey: key,
        body: {
          items: cart.lines.map((l) => ({
            menuItemId: l.menuItemId,
            quantity: l.quantity,
            addOnIds: l.addOnIds,
            note: l.note || null,
          })),
        },
      }),
    onSuccess: async (order) => {
      cart.clear();
      setSubmitKey(null);
      setCartOpen(false);
      setLastOrder(order);
      setTab('table');
      await qc.invalidateQueries({ queryKey: ['session'] });
    },
    onError: (err) => {
      // A definite rejection (e.g. sold out) needs a fresh key; network errors retry with the same one.
      if (err instanceof ApiError && err.status > 0) setSubmitKey(null);
      if (err instanceof ApiError && err.code === 'ITEM_UNAVAILABLE')
        void qc.invalidateQueries({ queryKey: ['session'] });
    },
  });
  const sendOrder = () => {
    const key = submitKey ?? crypto.randomUUID();
    setSubmitKey(key);
    submit.mutate(key);
  };
  const requestBill = useMutation({
    mutationFn: () => post('/v1/public/session/requests', { type: 'REQUEST_BILL' }),
  });
  const billRequested =
    requestBill.isSuccess || session.openRequests.some((r) => r.type === 'REQUEST_BILL');

  const soldOut = new Set(
    session.menu.flatMap((c) => c.items.filter((i) => !i.isAvailable).map((i) => i.id)),
  );
  const unavailableInCart = cart.lines.filter((l) => soldOut.has(l.menuItemId));
  const prepay = session.venue.paymentMode === 'PREPAY';
  const awaiting = session.tab.orders.filter((o) => o.status === 'AWAITING_PAYMENT' && o.mine);

  if (closed) {
    return (
      <main className="mx-auto max-w-lg space-y-4 px-4 py-6">
        <Alert tone="green">
          <strong className="block text-base">Thank you!</strong>
          This table has been closed.
        </Alert>
        <Link
          to={`/r/${session.tab.receiptToken}`}
          className="block rounded-2xl bg-brand-700 px-4 py-3 text-center font-semibold text-white"
        >
          View receipt
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-4 pb-40">
      <div className="sticky top-0 z-30 -mx-4 flex gap-2 bg-stone-50 px-4 pt-3" role="tablist">
        {(['menu', 'table'] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cx(
              'flex-1 rounded-2xl py-2.5 text-sm font-bold',
              tab === t ? 'bg-stone-900 text-white' : 'bg-white ring-1 ring-stone-200',
            )}
          >
            {t === 'menu' ? (
              'Menu'
            ) : (
              <>
                Your table · <Money kobo={session.tab.totals.balanceKobo} />
              </>
            )}
          </button>
        ))}
      </div>

      {lastOrder && tab === 'table' && (
        <div className="mt-3">
          <Alert tone={lastOrder.status === 'AWAITING_PAYMENT' ? 'amber' : 'green'}>
            {lastOrder.status === 'AWAITING_PAYMENT'
              ? `Order #${lastOrder.number} is waiting for payment. It goes to the kitchen and bar once paid.`
              : `Order #${lastOrder.number} sent. You can follow it here.`}
          </Alert>
        </div>
      )}

      {tab === 'menu' ? (
        <MenuView menu={session.menu} canOrder onAdd={(l) => cart.add(l)} />
      ) : (
        <div className="mt-3 space-y-3">
          {awaiting.length > 0 && prepay && (
            <Alert tone="amber">Pay for your order to send it to the kitchen and bar.</Alert>
          )}
          <TabView tab={session.tab} />
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto max-w-lg space-y-2">
          {cart.count > 0 && (
            <Button className="w-full justify-between" onClick={() => setCartOpen(true)}>
              <span>View order ({cart.count})</span>
              <Money kobo={cart.totalKobo} />
            </Button>
          )}
          <div className="grid grid-cols-3 gap-2">
            <CallWaiterButton slug={slug} token={token} className="px-2 text-sm" />
            <Button
              variant="secondary"
              className="px-2 text-sm"
              busy={requestBill.isPending}
              disabled={billRequested}
              onClick={() => requestBill.mutate()}
            >
              {billRequested ? '✓ Bill asked' : '🧾 Request bill'}
            </Button>
            <PayButton session={session} />
          </div>
        </div>
      </div>

      <Sheet open={cartOpen} onClose={() => setCartOpen(false)} title="Your order">
        {cart.lines.length === 0 ? (
          <p className="text-stone-600">Your order is empty.</p>
        ) : (
          <div className="space-y-4">
            <ul className="divide-y divide-stone-100">
              {cart.lines.map((l) => (
                <li key={l.key} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className={cx('font-semibold', soldOut.has(l.menuItemId) && 'text-red-700')}>
                      {l.name} {soldOut.has(l.menuItemId) && '(sold out)'}
                    </p>
                    {l.addOnNames.length > 0 && (
                      <p className="text-sm text-stone-500">{l.addOnNames.join(', ')}</p>
                    )}
                    {l.note && <p className="text-sm italic text-stone-500">“{l.note}”</p>}
                    <p className="text-sm">
                      <Money kobo={l.unitPriceKobo * l.quantity} />
                    </p>
                  </div>
                  <div className="flex items-center rounded-xl ring-1 ring-stone-300">
                    <button
                      type="button"
                      className="px-3 py-2"
                      aria-label={`Fewer ${l.name}`}
                      onClick={() => cart.setQuantity(l.key, l.quantity - 1)}
                    >
                      −
                    </button>
                    <span className="w-6 text-center font-bold tabular-nums">{l.quantity}</span>
                    <button
                      type="button"
                      className="px-3 py-2"
                      aria-label={`More ${l.name}`}
                      onClick={() => cart.setQuantity(l.key, l.quantity + 1)}
                    >
                      +
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {unavailableInCart.length > 0 && (
              <Alert>Remove sold-out items to send your order.</Alert>
            )}
            {submit.error && <Alert>{errorMessage(submit.error)}</Alert>}
            <p className="text-sm text-stone-500">
              {prepay
                ? 'You pay for this order before it goes to the kitchen and bar.'
                : session.venue.pricesIncludeVat
                  ? 'Prices include VAT. Your tab is settled at the end.'
                  : 'VAT is added on your bill. Your tab is settled at the end.'}
            </p>
            <Button
              className="w-full justify-between"
              busy={submit.isPending}
              disabled={unavailableInCart.length > 0}
              onClick={sendOrder}
            >
              <span>{prepay ? 'Place order' : 'Send order'}</span>
              <Money kobo={cart.totalKobo} />
            </Button>
          </div>
        )}
      </Sheet>
    </main>
  );
}
