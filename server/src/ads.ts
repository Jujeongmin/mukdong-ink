// Rewarded-ad verification (docs.verse8.io/ko/docs/ads/server-verification): the platform's verifier
// answers whether the ad behind a requestId was watched. The page shows it with `fetch`; the game-server
// docs do not say whether the server sandbox has `fetch`, so without it (or when the request itself
// cannot be made) the claim is "unverifiable" and the caller decides (the daily cap and the requestId
// receipt still hold). The local in-page server installs `$verifyAd` instead (see src/net/local).

export type AdCheck = "verified" | "pending" | "rejected" | "unverifiable";

const VERIFIER = "https://ads-verifier.verse8.io/ads/status?requestId=";

type Fetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

function localVerifier(): ((requestId: string) => Promise<AdCheck>) | null {
  const fn = (globalThis as Record<string, unknown>).$verifyAd;
  return typeof fn === "function" ? (fn as (requestId: string) => Promise<AdCheck>) : null;
}

export async function verifyAd(requestId: string): Promise<AdCheck> {
  const local = localVerifier();
  if (local) return local(requestId);
  const f = (globalThis as Record<string, unknown>).fetch;
  if (typeof f !== "function") return "unverifiable";
  let res: Awaited<ReturnType<Fetch>>;
  try {
    res = await (f as Fetch)(VERIFIER + encodeURIComponent(requestId));
  } catch {
    return "unverifiable";
  }
  if (!res.ok && res.status !== 202) return "rejected";
  let status: unknown;
  try {
    status = ((await res.json()) as { status?: unknown } | null)?.status;
  } catch {
    return "rejected";
  }
  if (status === "verified") return "verified";
  if (status === "pending") return "pending";
  return "rejected";
}
