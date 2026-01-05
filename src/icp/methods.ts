// src/icp/methods.ts

export type MethodInfo = {
  name: string;
  kind: "query" | "update";
};

/**
 * Browser-safe MVP method extractor.
 * Scans the "service : { ... }" block and extracts:
 *   - method name
 *   - query/update (based on presence of "query" keyword on that line)
 */
export function extractMethods(didText: string): MethodInfo[] {
  const sIdx = didText.indexOf("service");
  if (sIdx < 0) return [];

  const tail = didText.slice(sIdx);

  const open = tail.indexOf("{");
  if (open < 0) return [];

  // Find matching closing brace for the service block
  let depth = 0;
  let close = -1;
  for (let i = open; i < tail.length; i++) {
    const ch = tail[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) return [];

  const body = tail.slice(open + 1, close);

  const list: MethodInfo[] = [];
  const lines = body.split("\n");

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;

    // Match "method_name :"
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:/);
    if (!m) continue;

    const name = m[1];
    const isQuery = /\bquery\b/.test(line);
    list.push({ name, kind: isQuery ? "query" : "update" });
  }

  list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}
