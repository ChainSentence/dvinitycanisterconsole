// src/icp/runner.ts
import { HttpAgent } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";
import { Principal } from "@dfinity/principal";
import type { MethodSig } from "./methods";

type StatusCb = (msg: string) => void;

/**
 * Supported input (Candid-ish):
 *   () / empty
 *   (1) / (1 : nat64) / (1 : nat)
 *   ("hello")
 *   (true) / (false)
 *   (null)
 *   (principal "aaaaa-aa")
 *   (opt principal "aaaaa-aa") / (opt null)
 *   (vec { 1; 2; 3 }) / (vec { 1; 2 } : nat64) / (vec { 1; 2 } : nat)
 *   (vec { 1; 2; 255 } : nat8)         // becomes Uint8Array
 *   (vec { principal "a"; principal "b" })
 *
 * Multi-arg:
 *   (0, 50)
 *   (principal "aaaaa-aa", 10)
 *   (vec { 1; 2; 3 }, opt null)
 */

type ArgVal =
  | { kind: "nat"; value: bigint }
  | { kind: "principal"; value: string }
  | { kind: "opt_principal"; value: string | null }
  | { kind: "vec_nat"; value: bigint[] }
  | { kind: "vec_nat8"; value: number[] }
  | { kind: "vec_principal"; value: string[] }
  | { kind: "text"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "null" };

function splitTopLevelComma(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depthBrace = 0; // { }
  let inStr = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (ch === '"' && s[i - 1] !== "\\") inStr = !inStr;

    if (!inStr) {
      if (ch === "{") depthBrace++;
      else if (ch === "}") depthBrace--;

      if (ch === "," && depthBrace === 0) {
        out.push(cur.trim());
        cur = "";
        continue;
      }
    }

    cur += ch;
  }

  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseVecBody(body: string): string[] {
  return body
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseSingleArgText(s: string): ArgVal {
  const t = s.trim();
  if (!t) throw new Error("Empty argument");

  // null
  if (t === "null") return { kind: "null" };

  // bool
  if (t === "true" || t === "false") return { kind: "bool", value: t === "true" };

  // text "..."
  const tm = t.match(/^"([\s\S]*)"$/);
  if (tm) return { kind: "text", value: tm[1] };

  // principal "aaaaa-aa"
  const pm = t.match(/^principal\s+"([^"]+)"$/);
  if (pm) return { kind: "principal", value: pm[1] };

  // opt principal "aaaaa-aa" / opt null
  const opm = t.match(/^opt\s+principal\s+"([^"]+)"$/);
  if (opm) return { kind: "opt_principal", value: opm[1] };
  if (t === "opt null") return { kind: "opt_principal", value: null };

  // vec { ... } : nat8  (explicit nat8)
  const v8m = t.match(/^vec\s*\{\s*([\s\S]*)\s*\}\s*:\s*nat8$/);
  if (v8m) {
    const body = v8m[1].trim();
    if (!body) return { kind: "vec_nat8", value: [] };

    const parts = parseVecBody(body);
    const nums = parts.map((p) => {
      const m = p.match(/^(\d+)(\s*:\s*nat8)?$/);
      if (!m) throw new Error(`Unsupported vec nat8 element: "${p}"`);
      const n = Number(m[1]);
      if (n < 0 || n > 255) throw new Error(`nat8 out of range (0..255): ${n}`);
      return n;
    });

    return { kind: "vec_nat8", value: nums };
  }

  // vec { principal "a"; principal "b" }
  const vpm = t.match(/^vec\s*\{\s*([\s\S]*)\s*\}$/);
  if (vpm && /\bprincipal\s+"/.test(t)) {
    const body = vpm[1].trim();
    if (!body) return { kind: "vec_principal", value: [] };

    const parts = parseVecBody(body);
    const principals = parts.map((p) => {
      const m = p.match(/^principal\s+"([^"]+)"$/);
      if (!m) throw new Error(`Unsupported vec principal element: "${p}"`);
      return m[1];
    });

    return { kind: "vec_principal", value: principals };
  }

  // vec { ... } numbers -> treat as vec nat
  const vnm = t.match(/^vec\s*\{\s*([\s\S]*)\s*\}(?:\s*:\s*(nat|nat64|nat32|nat16))?$/);
  if (vnm) {
    const body = vnm[1].trim();
    if (!body) return { kind: "vec_nat", value: [] };

    const parts = parseVecBody(body);
    const nums = parts.map((p) => {
      const m = p.match(/^(\d+)(\s*:\s*(nat|nat64|nat32|nat16))?$/);
      if (!m) throw new Error(`Unsupported vec element: "${p}". Use 1 or 1 : nat64`);
      return BigInt(m[1]);
    });

    return { kind: "vec_nat", value: nums };
  }

  // number -> nat-ish (BigInt)
  const nm = t.match(/^(\d+)(\s*:\s*(nat|nat64|nat32|nat16|nat8))?$/);
  if (nm) return { kind: "nat", value: BigInt(nm[1]) };

  throw new Error(`Unsupported arg: "${s}"`);
}

function parseArgsText(argsText: string): ArgVal[] {
  const t = (argsText || "").trim();
  if (t === "" || /^\(\s*\)$/.test(t)) return [];

  if (!t.startsWith("(") || !t.endsWith(")")) {
    throw new Error('Args must be wrapped in parentheses, e.g. (), (1), (0, 50)');
  }

  const inner = t.slice(1, -1).trim();
  if (!inner) return [];

  const parts = splitTopLevelComma(inner);
  return parts.map(parseSingleArgText);
}

function toHex(u8: Uint8Array): string {
  return Array.from(u8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toBase64(u8: Uint8Array): string {
  let bin = "";
  for (const b of u8) bin += String.fromCharCode(b);
  return btoa(bin);
}

function jsonReplacer(_k: string, v: any) {
  if (typeof v === "bigint") return v.toString();
  if (v && typeof v === "object" && typeof v.toText === "function") return v.toText();
  if (v instanceof Uint8Array) return { bytes: v.length, hex: toHex(v) };
  return v;
}

function unwrapSingle(decoded: any[]) {
  return decoded.length === 1 ? decoded[0] : decoded;
}

function rawDump(u8: Uint8Array, meta: Record<string, any> = {}) {
  return JSON.stringify(
    {
      ...meta,
      bytes: u8.length,
      base64: toBase64(u8),
      hex: toHex(u8),
    },
    null,
    2
  );
}

/**
 * Explicit polling for update replies.
 * We poll read_state until the request is replied/rejected.
 */
async function pollUpdate(
  agent: HttpAgent,
  canisterId: string,
  requestId: Uint8Array,
  onStatus?: StatusCb
): Promise<any> {
  const a: any = agent;

  const maxAttempts = 60; // ~42s at 700ms
  for (let i = 0; i < maxAttempts; i++) {
    onStatus?.(`Polling update status… (${i + 1}/${maxAttempts})`);

    const state = await a.readState(canisterId, {
      paths: [[new TextEncoder().encode("request_status"), requestId]],
    });

    const status =
      state?.request_status?.status ??
      state?.status ??
      state?.requestStatus?.status ??
      null;

    if (status === "replied" || status === "rejected" || status === "done") {
      return state;
    }

    if (typeof a.requestStatus === "function") {
      try {
        const rs = await a.requestStatus(canisterId, requestId);
        if (rs?.status === "replied" || rs?.status === "rejected" || rs?.status === "done") {
          return rs;
        }
      } catch {
        // ignore
      }
    }

    await new Promise((r) => setTimeout(r, 700));
  }

  throw new Error("Update polling timed out (no reply/reject).");
}

export async function runMethod(opts: {
  canisterId: string;
  methodSig: MethodSig;
  argsText: string;
  isQuery: boolean;
  identity?: any;
  onStatus?: StatusCb;
}): Promise<string> {
  const agent = new HttpAgent({
    host: "https://icp-api.io",
    identity: opts.identity,
  });

  const parsed = parseArgsText(opts.argsText);
  const argTypes = opts.methodSig.argTypes ?? [];

  if (parsed.length !== argTypes.length) {
    throw new Error(
      `Arg count mismatch: method expects ${argTypes.length} args, you provided ${parsed.length}.`
    );
  }

  const argValues: any[] = parsed.map((a) => {
    switch (a.kind) {
      case "principal":
        return Principal.fromText(a.value);

      // Candid opt is encoded as [] for null, [value] for some
      case "opt_principal":
        return a.value === null ? [] : [Principal.fromText(a.value)];

      case "nat":
        return a.value; // BigInt works for nat/nat64/nat32/etc

      case "vec_nat":
        return a.value; // bigint[]

      case "vec_nat8":
        return Uint8Array.from(a.value); // vec nat8

      case "vec_principal":
        return a.value.map((p) => Principal.fromText(p));

      case "text":
        return a.value;

      case "bool":
        return a.value;

      case "null":
        return null;

      default:
        return a as never;
    }
  });

  const arg = IDL.encode(argTypes, argValues);

  const haveRetTypes = Array.isArray(opts.methodSig.retTypes) && opts.methodSig.retTypes.length > 0;

  // -------------------- QUERY --------------------
  if (opts.isQuery) {
    const res: any = await agent.query(opts.canisterId, {
      methodName: opts.methodSig.name,
      arg,
    });

    if (res?.status && res.status !== "replied") {
      return JSON.stringify(res, null, 2);
    }

    const replyBuf = res?.reply?.arg;
    if (!replyBuf) {
      return JSON.stringify({ error: "No reply.arg in query response", raw: res }, null, 2);
    }

    const u8 = new Uint8Array(replyBuf);

    if (!haveRetTypes) {
      return rawDump(u8, {
        ok: true,
        mode: "query",
        method: opts.methodSig.name,
        note: "No retTypes available, showing RAW bytes.",
      });
    }

    const decoded = IDL.decode(opts.methodSig.retTypes, u8);
    return JSON.stringify(unwrapSingle(decoded), jsonReplacer, 2);
  }

  // -------------------- UPDATE --------------------
  const submit: any = await agent.call(opts.canisterId, {
    methodName: opts.methodSig.name,
    arg,
  });

  const requestId: Uint8Array | undefined = submit?.requestId;
  if (!requestId) {
    return JSON.stringify({ error: "No requestId from agent.call()", raw: submit }, null, 2);
  }

  const polled: any = await pollUpdate(agent, opts.canisterId, requestId, opts.onStatus);

  const replyBuf =
    polled?.reply?.arg ??
    polled?.request_status?.reply?.arg ??
    polled?.requestStatus?.reply?.arg ??
    null;

  const status =
    polled?.status ??
    polled?.request_status?.status ??
    polled?.requestStatus?.status ??
    null;

  if (status && status !== "replied" && status !== "done") {
    return JSON.stringify(polled, null, 2);
  }

  if (!replyBuf) {
    return JSON.stringify({ error: "No reply.arg after polling", raw: polled }, null, 2);
  }

  const u8 = new Uint8Array(replyBuf as ArrayBuffer);

  if (!haveRetTypes) {
    return rawDump(u8, {
      ok: true,
      mode: "update",
      method: opts.methodSig.name,
      note: "No retTypes available, showing RAW bytes.",
    });
  }

  const decoded = IDL.decode(opts.methodSig.retTypes, u8);
  return JSON.stringify(unwrapSingle(decoded), jsonReplacer, 2);
}
