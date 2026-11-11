import { useCallback, useEffect, useState } from 'react';

export interface CartLine {
  key: string;
  menuItemId: string;
  name: string;
  unitPriceKobo: number;
  addOnIds: string[];
  addOnNames: string[];
  quantity: number;
  note: string;
}

function load(storageKey: string): CartLine[] {
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as CartLine[]) : [];
  } catch {
    return [];
  }
}

/** Cart kept per table session in localStorage, so a reload or rescan keeps it. */
export function useCart(tableSessionId: string | null) {
  const storageKey = `cart:${tableSessionId ?? 'none'}`;
  const [lines, setLines] = useState<CartLine[]>(() => load(storageKey));
  useEffect(() => setLines(load(storageKey)), [storageKey]);
  useEffect(() => {
    try {
      if (lines.length) window.localStorage.setItem(storageKey, JSON.stringify(lines));
      else window.localStorage.removeItem(storageKey);
    } catch {
      /* storage unavailable (private mode): keep the cart in memory */
    }
  }, [lines, storageKey]);

  const add = useCallback((line: Omit<CartLine, 'key'>) => {
    setLines((prev) => {
      const same = prev.find(
        (l) =>
          l.menuItemId === line.menuItemId &&
          l.note === line.note &&
          l.addOnIds.join() === line.addOnIds.join(),
      );
      if (same)
        return prev.map((l) =>
          l === same ? { ...l, quantity: Math.min(50, l.quantity + line.quantity) } : l,
        );
      return [...prev, { ...line, key: crypto.randomUUID() }];
    });
  }, []);
  const setQuantity = useCallback((key: string, quantity: number) => {
    setLines((prev) =>
      quantity <= 0
        ? prev.filter((l) => l.key !== key)
        : prev.map((l) => (l.key === key ? { ...l, quantity: Math.min(50, quantity) } : l)),
    );
  }, []);
  const clear = useCallback(() => setLines([]), []);
  const totalKobo = lines.reduce((s, l) => s + l.unitPriceKobo * l.quantity, 0);
  const count = lines.reduce((s, l) => s + l.quantity, 0);
  return { lines, add, setQuantity, clear, totalKobo, count };
}
