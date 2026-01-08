import { icrc1BalanceOf, icrc1Transfer } from "./icp/icrcClient";
import "./App.css";
import { useEffect, useMemo, useState } from "react";
import {
  II_2,
  II_LEGACY,
  getPrincipalText,
  isAuthed,
  login,
  logout,
} from "./icp/auth";
import {
  clearCachedCandid,
  fetchAndCacheCandid,
  getCachedCandid,
} from "./icp/candid";
import { extractMethodSigs, type MethodSig } from "./icp/methods";
import { runMethod } from "./icp/runner";
import { getIdentity } from "./icp/auth";

// ✅ Assets (Vite)
import markHeader from "./assets/mark-header.svg";
import icpLogo from "./assets/icp.png";

/** Build a default args string from IDL display() */
function placeholderForType(t: any): string {
  const d = typeof t?.display === "function" ? String(t.display()) : "";

  if (d.startsWith("opt ")) return "null";
  if (d.startsWith("vec ")) return "vec { }";

  if (d === "principal") return 'principal "aaaaa-aa"';
  if (d === "text") return '"..."';
  if (d === "bool") return "false";
  if (d === "null") return "null";

  if (/^(nat|int)\d*$/.test(d)) return "0";

  if (d.startsWith("record")) return "record { }";
  if (d.startsWith("variant")) return "variant { }";

  return "null";
}

function buildArgsPlaceholder(argTypes: any[] | undefined | null): string {
  const args = Array.isArray(argTypes) ? argTypes : [];
  if (args.length === 0) return "()";
  return `(${args.map(placeholderForType).join(", ")})`;
}

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [principal, setPrincipal] = useState<string>("");

  const [argsText, setArgsText] = useState("()");
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);

  const [methods, setMethods] = useState<MethodSig[]>([]);
  const [method, setMethod] = useState("");
  const [methodKind, setMethodKind] = useState<"query" | "update" | "unknown">(
    "unknown"
  );

  const [canisterId, setCanisterId] = useState<string>("");
  const [status, setStatus] = useState<string>("");

// 🔹 GLOBAL DFX inputs (ICRC-1)
  // Balance helper
  const [ledgerBalanceId, setLedgerBalanceId] = useState<string>("");
  const [dfxOwner, setDfxOwner] = useState<string>("");       // owner principal
  const [dfxOwnerSub, setDfxOwnerSub] = useState<string>(""); // owner subaccount (hex, optional)

  // Transfer helper
  const [ledgerTransferId, setLedgerTransferId] = useState<string>("");
  const [dfxTo, setDfxTo] = useState<string>("");             // dest principal
  const [dfxToSub, setDfxToSub] = useState<string>("");       // dest subaccount (hex, optional)
  const [dfxFromSub, setDfxFromSub] = useState<string>("");   // from_subaccount (hex, optional)
  const [dfxAmount, setDfxAmount] = useState<string>("0");    // raw nat


  const selectedSig = useMemo(
    () => methods.find((m) => m.name === method) ?? null,
    [methods, method]
  );

  async function refreshAuth() {
    const ok = await isAuthed();
    setAuthed(ok);
    setPrincipal(ok ? await getPrincipalText() : "");
  }

  useEffect(() => {
    refreshAuth();
  }, []);

  const cached = useMemo(() => {
    if (!canisterId.trim()) return null;
    return getCachedCandid(canisterId.trim());
  }, [canisterId]);

  async function onFetchInterface(force = false) {
    const id = canisterId.trim();
    if (!id) {
      setStatus("Enter a canister id first.");
      return;
    }

    try {
      setStatus("Fetching candid:service metadata…");
      if (force) clearCachedCandid(id);

      const entry = await fetchAndCacheCandid(id);
      const list = extractMethodSigs(entry.candidText);

      setMethods(list);

      // pick a default method if needed
      const next = method && list.some((m) => m.name === method) ? method : (list[0]?.name ?? "");
      setMethod(next);

      const found = list.find((m) => m.name === next);
      setMethodKind(found?.kind ?? "unknown");

      // ✅ auto placeholder for args
      setArgsText(buildArgsPlaceholder(found?.argTypes));

      setStatus(`Interface loaded ✅ (cached for 14 days)`);
    } catch (e: any) {
      setMethods([]);
      setMethod("");
      setMethodKind("unknown");
      setStatus(`Interface fetch failed ❌: ${e?.message ?? String(e)}`);
    }
  }

  function onLoadFromCache() {
    const id = canisterId.trim();
    if (!id) return;

    const res = getCachedCandid(id);
    if (!res.entry) {
      setStatus("No cached interface for this canister.");
      return;
    }

    const list = extractMethodSigs(res.entry.candidText);
    setMethods(list);

    const next = method && list.some((m) => m.name === method) ? method : (list[0]?.name ?? "");
    setMethod(next);

    const found = list.find((m) => m.name === next);
    setMethodKind(found?.kind ?? "unknown");
    setArgsText(buildArgsPlaceholder(found?.argTypes));

    setStatus(res.isFresh ? "Loaded from cache ✅" : "Loaded from cache (stale) ⚠️");
  }

  // A nice one-line signature under the dropdown (based on IDL display)
  const sigText = useMemo(() => {
    if (!selectedSig) return "";
    const args = (selectedSig.argTypes ?? []).map((t: any) => (t?.display ? t.display() : "?")).join(", ");
    const rets = (selectedSig.retTypes ?? []).map((t: any) => (t?.display ? t.display() : "?")).join(", ");
    return `${selectedSig.name} : (${args}) -> (${rets})${selectedSig.kind === "query" ? " query" : ""};`;
  }, [selectedSig]);

  function parseSubaccount(input: string): Uint8Array | null {
  const raw = input.trim();
  if (!raw) return null; // leeg = geen subaccount (null)

  const maybeHex = raw.toLowerCase().replace(/^0x/, "");
  const isHex = /^[0-9a-f]+$/.test(maybeHex);

  // Case 1: echte hex-string
  if (isHex) {
    if (maybeHex.length !== 64) {
      throw new Error("Hex subaccount must be 32 bytes = 64 hex characters.");
    }
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      const byte = maybeHex.slice(i * 2, i * 2 + 2);
      const value = Number.parseInt(byte, 16);
      if (Number.isNaN(value)) {
        throw new Error("Invalid hex in subaccount string.");
      }
      out[i] = value;
    }
    return out;
  }

  // Case 2: ASCII label (zoals "DVIN_LISTING_FEE_SUBACC_________")
  const enc = new TextEncoder();
  const bytes = enc.encode(raw);
  if (bytes.length !== 32) {
    throw new Error("ASCII subaccount label must be exactly 32 characters.");
  }
  return bytes;
}


function formatWithUnderscores(n: bigint): string {
  const s = n.toString();
  // reverse → group per 3 → join → reverse terug
  const r = s.split("").reverse().join("");
  const grouped = r.replace(/(\d{3})(?=\d)/g, "$1_");
  return grouped.split("").reverse().join("");
}


  // GLOBAL DFX: icrc1_balance_of zonder candid fetch

  async function onGlobalBalance() {
    const cid = ledgerBalanceId.trim();
    if (!cid) {
      setStatus("Enter a ledger canister id first (balance).");
      return;
    }

    const owner = (dfxOwner.trim() || principal || "").trim();
    if (!owner) {
      setStatus("No principal to check balance for. Login or fill owner principal.");
      return;
    }

    let sub: Uint8Array | null = null;
    try {
      sub = parseSubaccount(dfxOwnerSub)
    } catch (e: any) {
      setStatus(e?.message ?? String(e));
      return;
    }

    try {
      setRunning(true);
      setStatus("Running global icrc1_balance_of…");
      const bal = await icrc1BalanceOf(cid, owner, sub);
      const subInfo = sub ? ` (subaccount ${dfxOwnerSub.trim()})` : "";
      setOutput(
  `icrc1_balance_of(${owner}${subInfo}) = ${formatWithUnderscores(bal)} (raw units)`
);
    } catch (e: any) {
      setOutput(`Error (global balance): ${e?.message ?? String(e)}`);
    } finally {
      setRunning(false);
    }
  }

  // GLOBAL DFX: icrc1_transfer zonder candid fetch
  async function onGlobalTransfer() {
    const cid = ledgerTransferId.trim();
    if (!cid) {
      setStatus("Enter a ledger canister id first (transfer).");
      return;
    }
    if (!authed) {
      setStatus("Login with Internet Identity to sign transfers.");
      return;
    }

    const to = dfxTo.trim();
    if (!to) {
      setStatus("Enter a destination principal.");
      return;
    }

    const amtStr = dfxAmount.trim();
    if (!/^\d+$/.test(amtStr)) {
      setStatus("Amount must be a positive integer (raw ledger units).");
      return;
    }
    const amount = BigInt(amtStr);

    let fromSub: Uint8Array | null = null;
    let toSub: Uint8Array | null = null;
    try {
      fromSub = parseSubaccount(dfxFromSub);
      toSub   = parseSubaccount(dfxToSub);
    } catch (e: any) {
      setStatus(e?.message ?? String(e));
      return;
    }

    try {
      setRunning(true);
      setStatus("Running global icrc1_transfer…");
      const res = await icrc1Transfer(cid, to, amount, fromSub, toSub);

      if ("Ok" in res && res.Ok !== undefined) {
        setOutput(`icrc1_transfer → Ok: block_height = ${formatWithUnderscores(res.Ok)}`);
      } else if ("Err" in res && res.Err !== undefined) {
        setOutput("icrc1_transfer → Err:\n" + JSON.stringify(res.Err, null, 2));
      } else {
        setOutput(
          "icrc1_transfer → Unexpected response:\n" +
            JSON.stringify(res, null, 2)
        );
      }
    } catch (e: any) {
      setOutput(`Error (global transfer): ${e?.message ?? String(e)}`);
    } finally {
      setRunning(false);
    }
  }


    return (
    <div className="matrixWrap">
      {/* Top bar */}
      <div className="headerBar gridHint">
        <div className="brandLeft">
          <img className="brandLogo" src={markHeader} alt="Mark header" />
          <div>
            <div
              style={{
                fontWeight: 800,
                letterSpacing: 0.4,
                color: "var(--neon)",
              }}
            >
              Dvinity Canister Console
            </div>
            <div className="subTitle">
              DFX-style query &amp; update calls — right from the browser
            </div>
          </div>
        </div>

        {!authed ? (
          <>
            <button
              className="btn"
              onClick={async () => {
                await login(II_LEGACY);
                await refreshAuth();
              }}
            >
              Login (Legacy II)
            </button>
            <button
              className="btn btnPrimary"
              onClick={async () => {
                await login(II_2);
                await refreshAuth();
              }}
            >
              Login (II 2.0)
            </button>
          </>
        ) : (
          <>
            <div className="badge" title="Your principal">
              Principal: <code>{principal}</code>
            </div>
            <button
              className="btn"
              onClick={async () => {
                await logout();
                await refreshAuth();
              }}
            >
              Logout
            </button>
          </>
        )}
      </div>

      {/* Main panel */}
      <div className="panel">
        <div className="panelInner">
         

 {/* Canister input */}
          <div style={{ display: "grid", gap: 8 }}>
            <div className="label">Canister ID (mainnet)</div>
            <input
              className="input"
              value={canisterId}
              onChange={(e) => {
                setCanisterId(e.target.value);
                setMethods([]);
                setMethod("");
                setMethodKind("unknown");
                setStatus("");
              }}
              placeholder="aaaaa-aa"
            />
            <div className="smallMeta">
              Requires canisters to publish on-chain Candid metadata (
              <code>candid:service</code>).
            </div>
          </div>


          {/* Interface buttons + cache info */}
          <div className="row">
            <button className="btn" onClick={() => onFetchInterface(false)}>
              Fetch Interface
            </button>
            <button className="btn" onClick={() => onFetchInterface(true)}>
              Refresh (force)
            </button>
            <button className="btn" onClick={onLoadFromCache}>
              Load from Cache
            </button>
            <button
              className="btn"
              onClick={() => {
                const id = canisterId.trim();
                if (!id) return;
                clearCachedCandid(id);
                setStatus("Cache cleared.");
                setMethods([]);
                setMethod("");
                setMethodKind("unknown");
                setArgsText("()");
              }}
            >
              Clear Cache
            </button>

            {cached?.entry && (
              <div className="smallMeta">
                Cached:{" "}
                <code>
                  {cached.isFresh ? "fresh ✅" : "stale ⚠️"} | fetched{" "}
                  {new Date(cached.entry.fetchedAtMs).toLocaleString()}
                </code>
              </div>
            )}
          </div>


          <div className="hr" />

          {/* 🔹 GLOBAL DFX-style ICRC helpers (geen interface nodig) */}
          <div style={{ display: "grid", gap: 8 }}>
            <div className="label">Global DFX-style (ICRC-1)</div>
            <div className="smallMeta">
              Direct ICRC-1 calls with a built-in interface. No candid:service or "Fetch Interface" required.
            </div>

            {/* Balance-of */}
            <div className="smallMeta">Balance check</div>
            <div className="row">
              <input
                className="input"
                value={ledgerBalanceId}
                onChange={(e) => setLedgerBalanceId(e.target.value)}
                placeholder="Ledger canister ID (for balance)"
              />
            </div>
            <div className="row">
              <input
                className="input"
                value={dfxOwner}
                onChange={(e) => setDfxOwner(e.target.value)}
                placeholder="Owner principal (empty = your own)"
              />
            </div>
            <div className="row">
              <input
                className="input"
                value={dfxOwnerSub}
                onChange={(e) => setDfxOwnerSub(e.target.value)}
                placeholder="Owner subaccount (64-char hex, optional)"
              />
              <button
                className="btn"
                type="button"
                disabled={running}
                onClick={onGlobalBalance}
              >
                Global Balance
              </button>
            </div>

            <div className="hr" />

            {/* Transfer */}
            <div className="smallMeta">Transfer</div>
            <div className="row">
              <input
                className="input"
                value={ledgerTransferId}
                onChange={(e) => setLedgerTransferId(e.target.value)}
                placeholder="Ledger canister ID (for transfer)"
              />
            </div>
            <div className="row">
              <input
                className="input"
                value={dfxTo}
                onChange={(e) => setDfxTo(e.target.value)}
                placeholder="Transfer to principal"
              />
            </div>
            <div className="row">
              <input
                className="input"
                value={dfxToSub}
                onChange={(e) => setDfxToSub(e.target.value)}
                placeholder="Destination subaccount (64-char hex, optional)"
              />
            </div>
            <div className="row">
              <input
                className="input"
                value={dfxFromSub}
                onChange={(e) => setDfxFromSub(e.target.value)}
                placeholder="From subaccount (64-char hex, optional)"
              />
            </div>
            <div className="row">
              <input
                className="input"
                value={dfxAmount}
                onChange={(e) => setDfxAmount(e.target.value)}
                placeholder="Amount (raw nat, e.g. 100000000 = 1 token)"
              />
              <button
                className="btn"
                type="button"
                disabled={running}
                onClick={onGlobalTransfer}
              >
                Global Transfer
              </button>
            </div>
          </div>


          <div className="hr" />

          {/* Method selector */}
          <div style={{ display: "grid", gap: 8 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <div className="label">Method</div>
                <div className="smallMeta">
                  Detected: <code>{methodKind}</code> &nbsp;|&nbsp; Methods:{" "}
                  <code>{methods.length}</code>
                </div>
              </div>

              <button
                className="btn"
                type="button"
                onClick={() => {
                  if (!selectedSig) return;
                  setArgsText(buildArgsPlaceholder(selectedSig.argTypes));
                }}
                disabled={!selectedSig}
              >
                Reset args
              </button>
            </div>

            <select
              className="select"
              value={method}
              onChange={(e) => {
                const name = e.target.value;
                setMethod(name);

                const found = methods.find((m) => m.name === name);
                setMethodKind(found?.kind ?? "unknown");

                setArgsText(buildArgsPlaceholder(found?.argTypes));
              }}
              disabled={methods.length === 0}
            >
              {methods.length === 0 ? (
                <option value="">(fetch interface first)</option>
              ) : (
                methods.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name} ({m.kind})
                  </option>
                ))
              )}
            </select>

            {!!sigText && (
              <div className="sigLine">
                <code>{sigText}</code>
              </div>
            )}
          </div>

          <div className="hr" />

          {/* Args + run buttons */}
          <div style={{ display: "grid", gap: 8 }}>
            <div className="label">Arguments (Candid)</div>
            <textarea
              className="ta"
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              placeholder='Examples: (), (1), (vec { 1; 2 }), (principal "aaaaa-aa")'
            />

            <div className="row">
<button
  className="btn btnPrimary"
  disabled={running || !selectedSig}
  onClick={async () => {
    if (!selectedSig) return;
    try {
      setRunning(true);
      setOutput("Running query…");

      const identity = authed ? await getIdentity() : undefined;

      const res = await runMethod({
        canisterId,
        methodSig: selectedSig,
        argsText,
        isQuery: true,
        identity, // ✅ nu ook bij queries
      });

      setOutput(res);
    } catch (e: any) {
      setOutput(`Error: ${e.message ?? e}`);
    } finally {
      setRunning(false);
    }
  }}
>
  Run Query
</button>

              <button
                className="btn"
                disabled={running || !selectedSig || !authed || methodKind !== "update"}
                onClick={async () => {
                  if (!selectedSig) return;
                  try {
                    setRunning(true);
                    setOutput("Running update…");
                    const res = await runMethod({
                      canisterId,
                      methodSig: selectedSig,
                      argsText,
                      isQuery: false,
                      identity: await getIdentity(),
                      onStatus: (m) => setOutput(m),
                    });
                    setOutput(res);
                  } catch (e: any) {
                    setOutput(`Error: ${e.message ?? e}`);
                  } finally {
                    setRunning(false);
                  }
                }}
              >
                Run Call (update)
              </button>
            </div>
          </div>

          {/* Status */}
          {status && <div className="statusBox">{status}</div>}

          {/* Output */}
          {output && (
            <div className="outputBox" style={{ display: "grid", gap: 8 }}>
              <div className="label">Output</div>
              <textarea className="ta" value={output} readOnly />
            </div>
          )}
        </div>
      </div>

      {/* Bottom “Build on ICP” */}
    <div className="buildFooter">
  <div className="buildFooterInner">
    <span>Build on ICP</span>
    <img src={icpLogo} alt="ICP" style={{ height: 56, width: "auto" }} />
  </div>
</div>

    </div>
  );

}
