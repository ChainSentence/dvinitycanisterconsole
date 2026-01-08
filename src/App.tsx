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

  return (
    <div className="matrixWrap">
      <div className="headerBar gridHint">
        <div className="brandLeft">
          <img className="brandLogo" src={markHeader} alt="Mark header" />
          <div>
            <div style={{ fontWeight: 800, letterSpacing: 0.4, color: "var(--neon)" }}>
              Dvinity Canister Console
            </div>
            <div className="subTitle">DFX-style query &amp; update calls — right from the browser</div>
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

      <div className="panel">
        <div className="panelInner">
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
              Requires canisters to publish on-chain Candid metadata (<code>candid:service</code>).
            </div>
          </div>

          <div className="row">
            <button className="btn" onClick={() => onFetchInterface(false)}>Fetch Interface</button>
            <button className="btn" onClick={() => onFetchInterface(true)}>Refresh (force)</button>
            <button className="btn" onClick={onLoadFromCache}>Load from Cache</button>
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

          <div style={{ display: "grid", gap: 8 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <div className="label">Method</div>
                <div className="smallMeta">
                  Detected: <code>{methodKind}</code> &nbsp;|&nbsp; Methods: <code>{methods.length}</code>
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

                // ✅ auto placeholder for the selected method
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
                    const res = await runMethod({
                      canisterId,
                      methodSig: selectedSig,
                      argsText,
                      isQuery: true,
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

          {status && <div className="statusBox">{status}</div>}

          {output && (
            <div className="outputBox" style={{ display: "grid", gap: 8 }}>
              <div className="label">Output</div>
              <textarea className="ta" value={output} readOnly />
            </div>
          )}
        </div>
      </div>

{/* Bottom “Build on ICP” */}
<div
  style={{
    marginTop: 28,
    paddingTop: 18,
    borderTop: "1px solid rgba(255,255,255,0.12)",
    display: "flex",
    justifyContent: "center",
  }}
>
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 16,
      opacity: 0.95,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      letterSpacing: 1,
      fontSize: 28, // 2-3x groter
      fontWeight: 800,
      color: "var(--neon)",
      textTransform: "uppercase",
    }}
  >
    <span>Build on ICP</span>
    <img
      src={icpLogo}
      alt="ICP"
      style={{ height: 56, width: "auto" }} // 2-3x groter
    />
  </div>
</div>

    </div>
  );
}
