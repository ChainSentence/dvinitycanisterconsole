// src/ic/fetchCandid.ts
import { HttpAgent, Certificate, lookupResultToBuffer } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";

const HOST = "https://icp-api.io";
const enc = new TextEncoder();

function label(s: string): Uint8Array {
  return enc.encode(s);
}

export async function fetchCandidFromChain(canisterIdText: string): Promise<string> {
  const canisterId = Principal.fromText(canisterIdText);
  const agent = new HttpAgent({ host: HOST });

  // ✅ Ensure root key is available (some agent builds don't preload it)
  await agent.fetchRootKey();
  const rootKey = agent.rootKey;
  if (!rootKey) throw new Error("Failed to fetch IC root key from the boundary node.");

  const path: Array<Uint8Array> = [
    label("canister"),
    canisterId.toUint8Array(),
    label("metadata"),
    label("candid:service"),
  ];

  const rs = await agent.readState(canisterId, { paths: [path] });

  const cert = await Certificate.create({
    certificate: new Uint8Array(rs.certificate),
    rootKey,
    canisterId,
  });

  const lookup = cert.lookup_path(path);
  const buf = lookupResultToBuffer(lookup);

  if (!buf) {
    throw new Error(
      "No candid metadata found. Canister must publish 'icp:public candid:service'."
    );
  }

  return new TextDecoder().decode(buf).trim();
}
