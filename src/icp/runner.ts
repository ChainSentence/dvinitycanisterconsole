// src/icp/runner.ts
import { HttpAgent, pollForResponse } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
import { parseCandid } from "candid-parser-wasm";

function stripServiceBlock(did: string): string {
  const sIdx = did.indexOf("service");
  if (sIdx < 0) return did;

  // Find first '{' after "service"
  const braceStart = did.indexOf("{", sIdx);
  if (braceStart < 0) return did;

  // Walk braces to find matching '}'
  let depth = 0;
  let i = braceStart;
  for (; i < did.length; i++) {
    const ch = did[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        // include closing '}'
        i++;
        break;
      }
    }
  }

  // Remove "service ... }" block
  const before = did.slice(0, sIdx).trim();
  const after = did.slice(i).trim();

  return [before, after].filter(Boolean).join("\n\n").trim();
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

// Find return types by parsing the DID text directly:
// method : (args) -> (rets) query;
function findReturnTypesFromDid(did: string, method: string): string[] {
  // escape method name for regex
  const esc = method.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const re = new RegExp(
    String.raw`\b${esc}\b\s*:\s*\([^)]*\)\s*->\s*\(([^)]*)\)`,
    "m"
  );

  const m = did.match(re);
  if (!m) throw new Error(`Could not find return signature for "${method}" in DID`);

  const inside = m[1].trim();
  if (!inside) return [];

  // MVP: split by commas (safe for your current returns like "opt X", "vec Y", etc.)
  return inside.split(",").map((s) => s.trim()).filter(Boolean);
}

// decodeIdlArgs decodes "args bytes" for a method, so we create a dummy service:
// __ret : (RET_TYPES...) -> ();
function makeDecodeDid(didWithoutService: string, retTypes: string[]): string {
  const argsSig = retTypes.length ? retTypes.join(", ") : "";
  return `${didWithoutService}

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

  // Sanitize + inline simple aliases in service block
  const did = inlineSimpleAliasesInService(sanitizeDid(raw));

  // Split typedefs (everything before "service")
  const didWithoutService = stripServiceBlock(did);
const decodeDid = makeDecodeDid(didWithoutService, retTypes);
  const decodeParser = parseCandid(decodeDid);

  const agent = new HttpAgent({
    host: "https://icp-api.io",
    identity: opts.identity,
  });

  const canisterId = Principal.fromText(opts.canisterId);

  const argText = normalizeArgs(opts.argsText);
  const arg = parser.encodeIdlArgs(opts.method, argText);

  const decodeReply = (replyBytes: Uint8Array) => {
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
