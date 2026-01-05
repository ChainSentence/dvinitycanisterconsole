// src/icp/runner.ts
import { HttpAgent, pollForResponse } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
import { parseCandid } from "candid-parser-wasm";

function findReturnTypesFromDid(did: string, method: string): string[] {
  // Match: method_name : (args) -> (rets) query;
  // Also works for update without 'query'
  const re = new RegExp(
    String.raw`${method}\s*:\s*\([^)]*\)\s*->\s*\(([^)]*)\)`,
    "m"
  );
  const m = did.match(re);
  if (!m) throw new Error(`Could not find return signature for method "${method}" in DID`);
  const inside = m[1].trim();
  if (!inside) return [];
  // split by commas at top-level is hard; MVP: assume single return or simple comma list
  // Your stuff is mostly single return: opt Lottery, vec ResultBundle, etc.
  return inside.split(",").map((s) => s.trim()).filter(Boolean);
}


function sanitizeDid(input: string): string {
  let s = input.replace(/\r\n/g, "\n");
  s = s.replace(/\/\*[\s\S]*?\*\//g, ""); // /* ... */
  s = s.replace(/\/\/.*$/gm, "");         // // ...
  return s.trim();
}

// Inline ONLY simple aliases inside service signatures (LotteryId -> nat64)
function inlineSimpleAliasesInService(did: string): string {
  const aliasRe =
    /^\s*type\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(nat64|nat|int|text|principal|bool)\s*;\s*$/gm;

  const aliases = new Map<string, string>();
  let m: RegExpExecArray | null;
  while ((m = aliasRe.exec(did)) !== null) aliases.set(m[1], m[2]);
  if (aliases.size === 0) return did;

  const sIdx = did.indexOf("service");
  if (sIdx < 0) return did;

  const head = did.slice(0, sIdx);
  let tail = did.slice(sIdx);

  for (const [name, base] of aliases.entries()) {
    tail = tail.replace(new RegExp(`\\b${name}\\b`, "g"), base);
  }
  return head + tail;
}

function normalizeArgs(argsText: string): string {
  const t = (argsText || "").trim();
  if (t === "" || /^\(\s*\)$/.test(t)) return "()";
  return t;
}

function makeDecodeDid(typeDefsOnly: string, retTypes: string[]): string {
  // decodeIdlArgs decodes "args", so we define __ret(args=returnTypes)->()
  const argsSig = retTypes.length ? retTypes.join(", ") : "";
  return `${typeDefsOnly}
service : {
  __ret : (${argsSig}) -> ();
};`;
}

export async function runMethod(opts: {
  canisterId: string;
  didText: string;
  method: string;
  argsText: string;
  isQuery: boolean;
  identity?: any;
}): Promise<string> {
  const raw = (opts.didText || "").trim();
  if (!raw) throw new Error("No DID loaded yet. Click Fetch Interface first.");

  const did = inlineSimpleAliasesInService(sanitizeDid(raw));

  const sIdx = did.indexOf("service");
  if (sIdx < 0) throw new Error("DID has no service block.");
  const typeDefsOnly = did.slice(0, sIdx).trim();

  const parser = parseCandid(did);

  // IMPORTANT: this is the real API (no optional chaining)
  const retTypes = findReturnTypesFromDid(did, opts.method);
const decodeDid = makeDecodeDid(typeDefsOnly, retTypes);
const decodeParser = parseCandid(decodeDid);


const retTypes = retTypesRaw.map((t) => {
  let x = String(t).trim();

  // If parser returns TS-like array types: T[] or [T]
  // Convert:
  //   T[]    -> vec T
  //   [T]    -> vec T
  //   [A,B]  -> vec (A,B)  (best effort)
  if (x.endsWith("[]")) {
    x = `vec ${x.slice(0, -2).trim()}`;
  }

  // [ ... ] → vec ...
  if (x.startsWith("[") && x.endsWith("]")) {
    const inner = x.slice(1, -1).trim();
    if (inner.includes(",")) {
      // Best effort: treat as tuple element type list
      x = `vec (${inner})`;
    } else if (inner.length > 0) {
      x = `vec ${inner}`;
    } else {
      x = "vec empty";
    }
  }

  return x;
});

  const decodeDid = makeDecodeDid(typeDefsOnly, retTypes);
  const decodeParser = parseCandid(decodeDid);

  const agent = new HttpAgent({
    host: "https://icp-api.io",
    identity: opts.identity,
  });

  const canisterId = Principal.fromText(opts.canisterId);

  const argText = normalizeArgs(opts.argsText);
  const arg = parser.encodeIdlArgs(opts.method, argText);

  const decodeReply = (replyBytes: Uint8Array) => {
    // decode reply bytes as args of __ret
    return decodeParser.decodeIdlArgs("__ret", replyBytes);
  };

  if (opts.isQuery) {
    const res = await agent.query(canisterId, { methodName: opts.method, arg });

    if ("reject_code" in res) {
      throw new Error(`Query rejected: ${res.reject_code} ${res.reject_message}`);
    }

    return decodeReply(res.reply.arg);
  }

  const { requestId } = await agent.call(canisterId, {
    methodName: opts.method,
    arg,
  });

  const polled = await pollForResponse(agent, canisterId, requestId);
  return decodeReply(polled.reply.arg);
}

