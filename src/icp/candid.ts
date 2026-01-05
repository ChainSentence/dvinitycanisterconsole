// src/icp/candid.ts
import { HttpAgent } from "@dfinity/agent";
import { fetchCandidFromChain } from "../ic/fetchCandid";

const HOST = "https://icp-api.io";
const CACHE_PREFIX = "dcc:candid:"; // Dvinity Canister Console
const TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export type CandidCacheEntry = {
  canisterId: string;
  candidText: string;
  fetchedAtMs: number;
  // Optional debug fields:
  source: "metadata:candid:service";
};

function cacheKey(canisterId: string) {
  return `${CACHE_PREFIX}${canisterId}`;
}

export function getCachedCandid(canisterId: string): {
  entry: CandidCacheEntry | null;
  isFresh: boolean;
} {
  try {
    const raw = localStorage.getItem(cacheKey(canisterId));
    if (!raw) return { entry: null, isFresh: false };
    const entry = JSON.parse(raw) as CandidCacheEntry;
    const age = Date.now() - entry.fetchedAtMs;
    return { entry, isFresh: age <= TTL_MS };
  } catch {
    return { entry: null, isFresh: false };
  }
}

export function setCachedCandid(entry: CandidCacheEntry) {
  localStorage.setItem(cacheKey(entry.canisterId), JSON.stringify(entry));
}

export function clearCachedCandid(canisterId: string) {
  localStorage.removeItem(cacheKey(canisterId));
}

/**
 * Fetch Candid interface from on-chain metadata key: "candid:service"
 * This works only if the target canister publishes that metadata.
 */
export async function fetchCandidFromMetadata(canisterId: string): Promise<string> {
  const agent = new HttpAgent({ host: HOST });

  // readState metadata API: supported by @dfinity/agent
  // returns: Array<[string, ArrayBuffer]>
  const meta = await agent.readStateMetadata(canisterId, {
    paths: ["candid:service"],
  });

  const hit = meta.find(([k]) => k === "candid:service");
  if (!hit) {
    throw new Error("No candid:service metadata found.");
  }

  const [, buf] = hit;

  // metadata is bytes; interpret as UTF-8 text
  const candidText = new TextDecoder().decode(new Uint8Array(buf));

  const trimmed = candidText.trim();
  if (!trimmed) throw new Error("candid:service metadata was empty.");

  return trimmed;
}

export async function fetchAndCacheCandid(canisterId: string): Promise<CandidCacheEntry> {
  const candidText = await fetchCandidFromChain(canisterId);

  const entry: CandidCacheEntry = {
    canisterId,
    candidText,
    fetchedAtMs: Date.now(),
    source: "metadata:candid:service",
  };

  setCachedCandid(entry);
  return entry;
}

