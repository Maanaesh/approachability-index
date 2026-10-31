export type Route = { match: (url: URL, init?: RequestInit) => boolean; respond: () => Response | Promise<Response> };
export type FakeFetch = typeof fetch & { calls: { url: URL; init?: RequestInit }[] };

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// Routes are checked in order; unmatched requests fail loudly so tests never hit the network.
export function fakeFetch(routes: Route[]): FakeFetch {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push({ url, init });
    const route = routes.find((r) => r.match(url, init));
    if (!route) throw new Error(`unexpected fetch ${url}`);
    return route.respond();
  }) as FakeFetch;
  fn.calls = calls;
  return fn;
}
