export type Bag = { order: string[]; position: number; lastDrawn: string | null };

function shuffle(ids: string[], rng: () => number): string[] {
  const a = [...ids];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Every pool id comes up once per cycle. Ids removed from the pool are skipped,
// new ids join at the next refill, and a refill never starts with the last draw.
export function drawFromBag(bag: Bag | null, pool: string[], rng: () => number): { lineId: string; bag: Bag } {
  if (pool.length === 0) throw new Error('cannot draw from an empty pool');
  const inPool = new Set(pool);
  const lastDrawn = bag?.lastDrawn ?? null;

  if (bag) {
    for (let i = bag.position; i < bag.order.length; i++) {
      const id = bag.order[i];
      if (inPool.has(id)) return { lineId: id, bag: { order: bag.order, position: i + 1, lastDrawn: id } };
    }
  }

  const order = shuffle(pool, rng);
  if (order.length > 1 && order[0] === lastDrawn) {
    const j = 1 + Math.floor(rng() * (order.length - 1));
    [order[0], order[j]] = [order[j], order[0]];
  }
  return { lineId: order[0], bag: { order, position: 1, lastDrawn: order[0] } };
}
