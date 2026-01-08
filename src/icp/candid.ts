// src/icp/candid.ts
import { HttpAgent, CanisterStatus } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";

export type CachedCandidEntry = {
  candidText: string;
  fetchedAtMs: number;
};

const LS_PREFIX = "dcc:candid:";
const TTL_MS = 14 * 24 * 60 * 60 * 1000;

function keyFor(canisterId: string) {
  return `${LS_PREFIX}${canisterId}`;
}

export function getCachedCandid(canisterId: string): {
  entry: CachedCandidEntry | null;
  isFresh: boolean;
} {
  try {
    const raw = localStorage.getItem(keyFor(canisterId));
    if (!raw) return { entry: null, isFresh: false };
    const entry = JSON.parse(raw) as CachedCandidEntry;
    const isFresh = Date.now() - entry.fetchedAtMs < TTL_MS;
    return { entry, isFresh };
  } catch {
    return { entry: null, isFresh: false };
  }
}

export function clearCachedCandid(canisterId: string) {
  localStorage.removeItem(keyFor(canisterId));
}

async function fetchCandidFromChain(canisterIdText: string): Promise<string> {
  const canisterId = Principal.fromText(canisterIdText);

  // mainnet only
  const agent = new HttpAgent({
    host: "https://icp-api.io",
  });

  // GEEN fetchRootKey() op mainnet.

  // Dit is de “dfx manier”: metadata candid:service
  // key = jouw label in de response-map
  const result = await CanisterStatus.request({
    agent,
    canisterId,
    paths: [
      {
        // key is alleen een lookup-label (mag alles zijn)
        key: "candid",
        // dit is het echte metadata veld
        path: "candid:service",
        decodeStrategy: "utf-8",
      },
    ],
  });

  // result is doorgaans een Map<string, unknown>
  const v: any =
    (result as any)?.get?.("candid") ??
    (result as any)?.candid ??
    (result as any)?.get?.("candid:service");

  if (!v) {
    throw new Error(
      "No candid metadata found (expected public metadata `candid:service`)."
    );
  }

  if (typeof v === "string") return v;

  // soms komt het als bytes terug
  if (v instanceof Uint8Array) {
    return new TextDecoder().decode(v);
  }

  // laatste redmiddel
  return String(v);
}

export async function fetchAndCacheCandid(canisterId: string): Promise<CachedCandidEntry> {
  const did = await fetchCandidFromChain(canisterId);

  const entry: CachedCandidEntry = {
    candidText: did,
    fetchedAtMs: Date.now(),
  };

  localStorage.setItem(keyFor(canisterId), JSON.stringify(entry));
  return entry;
}
