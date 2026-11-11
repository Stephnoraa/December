import { useMemo, useState } from 'react';
import type { PublicMenuCategoryDto, PublicMenuItemDto } from '@app/shared';
import { Button, cx, Money, Sheet } from '../../components/ui';
import type { CartLine } from '../../lib/cart';

export function MenuView({
  menu,
  canOrder,
  onAdd,
}: {
  menu: PublicMenuCategoryDto[];
  canOrder: boolean;
  onAdd: (line: Omit<CartLine, 'key'>) => void;
}) {
  const [selected, setSelected] = useState<PublicMenuItemDto | null>(null);
  return (
    <div>
      <nav
        className="sticky top-0 z-20 -mx-4 flex gap-2 overflow-x-auto bg-stone-50/95 px-4 py-3 backdrop-blur"
        aria-label="Menu categories"
      >
        {menu.map((c) => (
          <a
            key={c.id}
            href={`#cat-${c.id}`}
            className="whitespace-nowrap rounded-full bg-white px-4 py-2 text-sm font-semibold ring-1 ring-stone-200 active:bg-stone-100"
          >
            {c.name}
          </a>
        ))}
      </nav>
      <div className="space-y-6 pb-4">
        {menu.map((c) => (
          <section key={c.id} id={`cat-${c.id}`} className="scroll-mt-16">
            <h2 className="mb-2 text-lg font-bold">{c.name}</h2>
            <ul className="divide-y divide-stone-200 overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200">
              {c.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={!item.isAvailable}
                    onClick={() => setSelected(item)}
                    className="flex w-full gap-3 p-3 text-left active:bg-stone-50 disabled:opacity-50"
                    aria-label={`${item.name}${item.isAvailable ? '' : ' (sold out)'}`}
                  >
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        width={80}
                        height={80}
                        className="h-20 w-20 shrink-0 rounded-xl bg-stone-100 object-cover"
                      />
                    ) : (
                      <div
                        className="h-20 w-20 shrink-0 rounded-xl bg-gradient-to-br from-brand-50 to-stone-100"
                        aria-hidden="true"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{item.name}</p>
                      {item.description && (
                        <p className="line-clamp-2 text-sm text-stone-600">{item.description}</p>
                      )}
                      <p className="mt-1 font-semibold">
                        {item.isAvailable ? (
                          <Money kobo={item.priceKobo} />
                        ) : (
                          <span className="text-red-700">Sold out</span>
                        )}
                      </p>
                    </div>
                    {item.isAvailable && canOrder && (
                      <span
                        className="self-center rounded-full bg-brand-700 px-3 py-1 text-sm font-bold text-white"
                        aria-hidden="true"
                      >
                        +
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <ItemSheet
        item={selected}
        canOrder={canOrder}
        onClose={() => setSelected(null)}
        onAdd={(l) => {
          onAdd(l);
          setSelected(null);
        }}
      />
    </div>
  );
}

function ItemSheet({
  item,
  canOrder,
  onClose,
  onAdd,
}: {
  item: PublicMenuItemDto | null;
  canOrder: boolean;
  onClose: () => void;
  onAdd: (line: Omit<CartLine, 'key'>) => void;
}) {
  const [addOnIds, setAddOnIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const [itemId, setItemId] = useState<string | null>(null);
  if (item && item.id !== itemId) {
    setItemId(item.id);
    setAddOnIds([]);
    setQuantity(1);
    setNote('');
  }
  const unit = useMemo(() => {
    if (!item) return 0;
    return (
      item.priceKobo +
      item.addOns.filter((a) => addOnIds.includes(a.id)).reduce((s, a) => s + a.priceDeltaKobo, 0)
    );
  }, [item, addOnIds]);
  if (!item) return null;
  const available = item.addOns.filter((a) => a.isAvailable);
  return (
    <Sheet open onClose={onClose} title={item.name}>
      {item.imageUrl && (
        <img
          src={item.imageUrl}
          alt=""
          className="mb-3 aspect-[4/3] w-full rounded-2xl object-cover"
        />
      )}
      {item.description && <p className="mb-3 text-stone-600">{item.description}</p>}
      <p className="mb-4 text-lg font-bold">
        <Money kobo={item.priceKobo} />
      </p>
      {canOrder ? (
        <>
          {available.length > 0 && (
            <fieldset className="mb-4">
              <legend className="mb-2 font-semibold">Add-ons (optional)</legend>
              <div className="space-y-2">
                {available.map((a) => (
                  <label
                    key={a.id}
                    className="flex items-center justify-between rounded-xl p-3 ring-1 ring-stone-200"
                  >
                    <span className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        className="h-5 w-5 accent-brand-700"
                        checked={addOnIds.includes(a.id)}
                        onChange={(e) =>
                          setAddOnIds((ids) =>
                            e.target.checked ? [...ids, a.id] : ids.filter((x) => x !== a.id),
                          )
                        }
                      />
                      {a.name}
                    </span>
                    <span className="text-sm text-stone-600">
                      {a.priceDeltaKobo > 0 ? (
                        <>
                          +<Money kobo={a.priceDeltaKobo} />
                        </>
                      ) : (
                        'Free'
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <label className="mb-4 block">
            <span className="mb-1 block font-semibold">Note for the kitchen (optional)</span>
            <input
              value={note}
              maxLength={200}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. no onions"
              className="w-full rounded-xl border-0 px-3 py-3 ring-1 ring-stone-300 focus:ring-2 focus:ring-brand-700"
            />
          </label>
          <div className="flex items-center gap-3">
            <div className="flex items-center rounded-2xl ring-1 ring-stone-300">
              <button
                type="button"
                className="px-4 py-3 text-xl"
                aria-label="Fewer"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              >
                −
              </button>
              <span className="w-8 text-center font-bold tabular-nums" aria-live="polite">
                {quantity}
              </span>
              <button
                type="button"
                className="px-4 py-3 text-xl"
                aria-label="More"
                onClick={() => setQuantity((q) => Math.min(50, q + 1))}
              >
                +
              </button>
            </div>
            <Button
              className="flex-1"
              onClick={() =>
                onAdd({
                  menuItemId: item.id,
                  name: item.name,
                  unitPriceKobo: unit,
                  addOnIds: [...addOnIds].sort(),
                  addOnNames: item.addOns.filter((a) => addOnIds.includes(a.id)).map((a) => a.name),
                  quantity,
                  note: note.trim(),
                })
              }
            >
              Add · <Money kobo={unit * quantity} />
            </Button>
          </div>
        </>
      ) : (
        <p className={cx('rounded-xl bg-amber-50 p-3 text-sm text-amber-900')}>
          Ordering opens once your waiter opens this table.
        </p>
      )}
    </Sheet>
  );
}
