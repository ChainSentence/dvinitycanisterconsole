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
import { extractMethods, type MethodInfo } from "./icp/methods";
import { runMethod } from "./icp/runner";
import { getIdentity } from "./icp/auth";


export default function App() {
  const [authed, setAuthed] = useState(false);
  const [principal, setPrincipal] = useState<string>("");

const [didText, setDidText] = useState<string>(""); // FULL did, never slice
const [argsText, setArgsText] = useState("()");
const [output, setOutput] = useState("");
const [running, setRunning] = useState(false);


  const [methods, setMethods] = useState<MethodInfo[]>([]);
  const [method, setMethod] = useState("");
  const [methodKind, setMethodKind] = useState<"query" | "update" | "unknown">(
    "unknown"
  );

  const [canisterId, setCanisterId] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [candidPreview, setCandidPreview] = useState<string>("");

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

      const list = extractMethods(entry.candidText);
      setMethods(list);

      if (!method && list.length > 0) {
        setMethod(list[0].name);
        setMethodKind(list[0].kind);
      } else {
        const found = list.find((m) => m.name === method);
        setMethodKind(found?.kind ?? "unknown");
      }
      setDidText(entry.candidText);
      setCandidPreview(entry.candidText);
      setStatus(`Interface loaded ✅ (cached for 14 days)`);
    } catch (e: any) {
      setCandidPreview("");
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
      setCandidPreview("");
      return;
    }

    const list = extractMethods(res.entry.candidText);
    setMethods(list);

    if (!method && list.length > 0) {
      setMethod(list[0].name);
      setMethodKind(list[0].kind);
    } else {
      const found = list.find((m) => m.name === method);
      setMethodKind(found?.kind ?? "unknown");
    }

    setStatus(res.isFresh ? "Loaded from cache ✅" : "Loaded from cache (stale) ⚠️");
    setDidText(res.entry.candidText);
    setCandidPreview(res.entry.candidText);
  }

  return (
    <div style={{ padding: 16, fontFamily: "system-ui", maxWidth: 1000 }}>
      <h1 style={{ margin: 0 }}>Dvinity Canister Console</h1>
      <p style={{ marginTop: 6 }}>
        DFX-style query &amp; update calls, right from the browser
      </p>

      {!authed ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={async () => {
              await login(II_LEGACY);
              await refreshAuth();
            }}
          >
            Login (Legacy II)
          </button>
          <button
            onClick={async () => {
              await login(II_2);
              await refreshAuth();
            }}
          >
            Login (II 2.0)
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span>
            Principal: <code>{principal}</code>
          </span>
          <button
            onClick={async () => {
              await logout();
              await refreshAuth();
            }}
          >
            Logout
          </button>
        </div>
      )}

      <hr style={{ margin: "16px 0" }} />

      <div style={{ display: "grid", gap: 10 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 600 }}>Canister ID (mainnet)</div>
          <input
            value={canisterId}
            onChange={(e) => {
              setCanisterId(e.target.value);
              setMethods([]);
              setMethod("");
              setMethodKind("unknown");
              setCandidPreview("");
              setStatus("");
              setDidText("")  
          }}
            placeholder="aaaaa-aa"
            style={{ padding: 10, fontSize: 14 }}
          />
          <div style={{ fontSize: 13, opacity: 0.85 }}>
            Requires canisters to publish on-chain Candid metadata{" "}
            (<code>candid:service</code>).
          </div>
        </label>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => onFetchInterface(false)}>Fetch Interface</button>
          <button onClick={() => onFetchInterface(true)}>Refresh (force)</button>
          <button onClick={onLoadFromCache}>Load from Cache</button>
          <button
            onClick={() => {
              const id = canisterId.trim();
              if (!id) return;
              clearCachedCandid(id);
              setStatus("Cache cleared.");
              setCandidPreview("");
              setMethods([]);
              setMethod("");
              setMethodKind("unknown");
            }}
          >
            Clear Cache
          </button>
        </div>

        {cached?.entry && (
          <div style={{ fontSize: 13, opacity: 0.9 }}>
            Cached:{" "}
            <code>
              {cached.isFresh ? "fresh ✅" : "stale ⚠️"} | fetched{" "}
              {new Date(cached.entry.fetchedAtMs).toLocaleString()}
            </code>
          </div>
        )}

        <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
          <div style={{ fontWeight: 600 }}>Method</div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={method}
              onChange={(e) => {
                const name = e.target.value;
                setMethod(name);
                const found = methods.find((m) => m.name === name);
                setMethodKind(found?.kind ?? "unknown");
              }}
              style={{ padding: 10, fontSize: 14, minWidth: 320 }}
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

            <span style={{ fontSize: 13, opacity: 0.9 }}>
              Detected: <code>{methodKind}</code>
            </span>

            <span style={{ fontSize: 13, opacity: 0.75 }}>
              Methods: <code>{methods.length}</code>
            </span>
          </div>
        </div>

<div style={{ display: "grid", gap: 6, marginTop: 12 }}>
  <div style={{ fontWeight: 600 }}>Arguments (Candid)</div>
  <textarea
    value={argsText}
    onChange={(e) => setArgsText(e.target.value)}
    placeholder='Examples: (), (1), ("hello"), (principal "aaaaa-aa")'
    style={{
      minHeight: 60,
      padding: 10,
      fontFamily: "ui-monospace, monospace",
    }}
  />

  <div style={{ display: "flex", gap: 8 }}>
    <button
      disabled={running}
      onClick={async () => {
        try {
          setRunning(true);
          setOutput("Running query…");
          const res = await runMethod({
  canisterId,
  didText: didText,
  method,
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
      disabled={running || !authed || methodKind !== "update"}
      onClick={async () => {
        try {
          setRunning(true);
          setOutput("Running update…");
          const res = await runMethod({
  canisterId,
  didText: didText,
  method,
  argsText,
  isQuery: false,
  identity: await getIdentity(),
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

        {status && (
          <div
            style={{
              padding: 10,
              border: "1px solid rgba(0,0,0,0.15)",
              borderRadius: 8,
              background: "rgba(0,0,0,0.03)",
              whiteSpace: "pre-wrap",
            }}
          >
            {status}
          </div>
        )}

{output && (
  <div style={{ display: "grid", gap: 6 }}>
    <div style={{ fontWeight: 600 }}>Output</div>
    <textarea
      value={output}
      readOnly
      style={{
        minHeight: 160,
        padding: 10,
        fontFamily: "ui-monospace, monospace",
      }}
    />
  </div>
)}

        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 600 }}>Candid preview</div>
          <textarea
            value={candidPreview}
            readOnly
            placeholder="(interface will appear here after fetch)"
            style={{
              minHeight: 220,
              padding: 10,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          />
        </div>
      </div>
    </div>
  );
}
