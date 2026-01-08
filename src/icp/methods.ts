// src/icp/methods.ts
import { IDL } from "@dfinity/candid";

export type MethodSig = {
  name: string;
  kind: "query" | "update";
  argTypes: IDL.Type[];
  retTypes: IDL.Type[];
  sigLine: string; // ✅ for UI: "foo : (nat64) -> (opt Bar) query;"
};

/** Remove // line comments */
function stripComments(s: string): string {
  return s.replace(/\/\/[^\n\r]*/g, "");
}

type Tok =
  | { t: "id"; v: string }
  | { t: "num"; v: string }
  | { t: "str"; v: string }
  | { t: "sym"; v: string }
  | { t: "eof" };

function tokenize(input: string): Tok[] {
  const s = stripComments(input);
  const out: Tok[] = [];
  let i = 0;

  const isWS = (c: string) => /\s/.test(c);
  const isIdStart = (c: string) => /[A-Za-z_]/.test(c);
  const isId = (c: string) => /[A-Za-z0-9_]/.test(c);
  const isNum = (c: string) => /[0-9]/.test(c);

  while (i < s.length) {
    const c = s[i];
    if (isWS(c)) {
      i++;
      continue;
    }

    // string "..."
    if (c === '"') {
      let j = i + 1;
      let buf = "";
      while (j < s.length) {
        const ch = s[j];
        if (ch === "\\" && j + 1 < s.length) {
          const nxt = s[j + 1];
          buf += nxt;
          j += 2;
          continue;
        }
        if (ch === '"') break;
        buf += ch;
        j++;
      }
      if (j >= s.length || s[j] !== '"') throw new Error("Unterminated string literal in DID");
      out.push({ t: "str", v: buf });
      i = j + 1;
      continue;
    }

    // numbers
    if (isNum(c)) {
      let j = i;
      while (j < s.length && isNum(s[j])) j++;
      out.push({ t: "num", v: s.slice(i, j) });
      i = j;
      continue;
    }

    // identifiers
    if (isIdStart(c)) {
      let j = i;
      while (j < s.length && isId(s[j])) j++;
      out.push({ t: "id", v: s.slice(i, j) });
      i = j;
      continue;
    }

    // symbols
    const sym = "{}();:,=<>-".includes(c) ? c : null;
    if (sym) {
      out.push({ t: "sym", v: sym });
      i++;
      continue;
    }

    // skip unknown char
    i++;
  }

  out.push({ t: "eof" });
  return out;
}

class Parser {
  toks: Tok[];
  p = 0;
  constructor(toks: Tok[]) {
    this.toks = toks;
  }
  peek(): Tok {
    return this.toks[this.p];
  }
  next(): Tok {
    return this.toks[this.p++];
  }
  expectSym(v: string) {
    const t = this.next();
    if (t.t !== "sym" || t.v !== v) throw new Error(`Expected symbol "${v}"`);
  }
  matchSym(v: string): boolean {
    const t = this.peek();
    if (t.t === "sym" && t.v === v) {
      this.p++;
      return true;
    }
    return false;
  }
  expectId(v?: string): string {
    const t = this.next();
    if (t.t !== "id") throw new Error(`Expected identifier${v ? ` "${v}"` : ""}`);
    if (v && t.v !== v) throw new Error(`Expected identifier "${v}"`);
    return t.v;
  }
  matchId(v: string): boolean {
    const t = this.peek();
    if (t.t === "id" && t.v === v) {
      this.p++;
      return true;
    }
    return false;
  }
  eof(): boolean {
    return this.peek().t === "eof";
  }
}

/** Type AST */
type TNode =
  | { k: "prim"; n: string }
  | { k: "ref"; n: string }
  | { k: "opt"; inner: TNode }
  | { k: "vec"; inner: TNode }
  | { k: "record"; fields: { name: string; ty: TNode }[]; positional?: boolean }
  | { k: "variant"; alts: { name: string; ty: TNode }[] };

function parseType(p: Parser): TNode {
  if (p.matchId("opt")) {
    const inner = parseType(p);
    return { k: "opt", inner };
  }
  if (p.matchId("vec")) {
    const inner = parseType(p);
    return { k: "vec", inner };
  }
  if (p.matchId("record")) {
    p.expectSym("{");
    const fields: { name: string; ty: TNode }[] = [];
    let positional = false;
    let posIdx = 0;

    while (!p.matchSym("}")) {
      const t = p.peek();

      if (t.t === "id") {
        const save = p.p;
        const id = p.expectId();
        if (p.matchSym(":")) {
          const ty = parseType(p);
          fields.push({ name: id, ty });
          p.matchSym(";");
        } else {
          positional = true;
          p.p = save;
          const ty = parseType(p);
          fields.push({ name: String(posIdx++), ty });
          p.matchSym(";");
        }
      } else {
        positional = true;
        const ty = parseType(p);
        fields.push({ name: String(posIdx++), ty });
        p.matchSym(";");
      }
    }
    return { k: "record", fields, positional };
  }
  if (p.matchId("variant")) {
    p.expectSym("{");
    const alts: { name: string; ty: TNode }[] = [];
    while (!p.matchSym("}")) {
      const name = p.expectId();
      let ty: TNode = { k: "prim", n: "null" };
      if (p.matchSym(":")) {
        ty = parseType(p);
      }
      alts.push({ name, ty });
      p.matchSym(";");
    }
    return { k: "variant", alts };
  }

  const id = p.expectId();
  const prims = new Set([
    "nat",
    "nat64",
    "nat32",
    "nat16",
    "nat8",
    "int",
    "int64",
    "int32",
    "int16",
    "int8",
    "bool",
    "text",
    "principal",
    "null",
    "blob",
    "reserved",
  ]);

  if (prims.has(id)) return { k: "prim", n: id };
  return { k: "ref", n: id };
}

function typeToText(node: TNode): string {
  if (node.k === "prim") return node.n;
  if (node.k === "ref") return node.n;
  if (node.k === "opt") return `opt ${typeToText(node.inner)}`;
  if (node.k === "vec") return `vec ${typeToText(node.inner)}`;
  if (node.k === "record") return "record { … }";
  if (node.k === "variant") return "variant { … }";
  return "reserved";
}

function parseTypeAliasesAndService(didText: string) {
  const toks = tokenize(didText);
  const p = new Parser(toks);

  const aliases = new Map<string, TNode>();
  const methodsRaw: {
    name: string;
    kind: "query" | "update";
    args: TNode[];
    rets: TNode[];
    sigLine: string;
  }[] = [];

  while (!p.eof()) {
    if (p.matchId("type")) {
      const name = p.expectId();
      p.expectSym("=");
      const ty = parseType(p);
      p.matchSym(";");
      aliases.set(name, ty);
      continue;
    }

    if (p.matchId("service")) {
      if (p.matchSym(":")) {
        // ok
      } else if (p.peek().t === "id") {
        p.next();
        p.expectSym(":");
      } else {
        p.matchSym(":");
      }

      p.expectSym("{");
      while (!p.matchSym("}")) {
        const t = p.peek();
        if (t.t === "eof") break;
        if (t.t !== "id") {
          p.next();
          continue;
        }

        const mname = p.expectId();
        if (!p.matchSym(":")) {
          continue;
        }

        // args
        p.expectSym("(");
        const args: TNode[] = [];
        if (!p.matchSym(")")) {
          while (true) {
            args.push(parseType(p));
            if (p.matchSym(",")) continue;
            p.expectSym(")");
            break;
          }
        }

        // ->
        p.expectSym("-");
        p.expectSym(">");

        // rets
        p.expectSym("(");
        const rets: TNode[] = [];
        if (!p.matchSym(")")) {
          while (true) {
            rets.push(parseType(p));
            if (p.matchSym(",")) continue;
            p.expectSym(")");
            break;
          }
        }

        let kind: "query" | "update" = "update";
        if (p.matchId("query")) kind = "query";

        // eat until ';'
        while (!p.matchSym(";")) {
          const tk = p.peek();
          if (tk.t === "eof" || (tk.t === "sym" && tk.v === "}")) break;
          p.next();
        }

        const sigLine =
          `${mname} : (${args.map(typeToText).join(", ")}) -> (${rets.map(typeToText).join(", ")})` +
          (kind === "query" ? " query;" : ";");

        methodsRaw.push({ name: mname, kind, args, rets, sigLine });
      }

      break;
    }

    p.next();
  }

  return { aliases, methodsRaw };
}

function toIDL(node: TNode, aliases: Map<string, TNode>, seen = new Set<string>()): IDL.Type {
  if (node.k === "ref") {
    const name = node.n;
    if (seen.has(name)) return IDL.Reserved;

    const ali = aliases.get(name);
    if (!ali) return IDL.Reserved;

    seen.add(name);
    const res = toIDL(ali, aliases, seen);
    seen.delete(name);
    return res;
  }

  if (node.k === "prim") {
    switch (node.n) {
      case "nat":
        return IDL.Nat;
      case "nat64":
        return IDL.Nat64;
      case "nat32":
        return IDL.Nat32;
      case "nat16":
        return IDL.Nat16;
      case "nat8":
        return IDL.Nat8;
      case "int":
        return IDL.Int;
      case "int64":
        return IDL.Int64;
      case "int32":
        return IDL.Int32;
      case "int16":
        return IDL.Int16;
      case "int8":
        return IDL.Int8;
      case "bool":
        return IDL.Bool;
      case "text":
        return IDL.Text;
      case "principal":
        return IDL.Principal;
      case "null":
        return IDL.Null;
      case "reserved":
        return IDL.Reserved;
      case "blob":
        return IDL.Vec(IDL.Nat8);
      default:
        return IDL.Reserved;
    }
  }

  if (node.k === "opt") return IDL.Opt(toIDL(node.inner, aliases, seen));
  if (node.k === "vec") return IDL.Vec(toIDL(node.inner, aliases, seen));

  if (node.k === "record") {
    const obj: Record<string, IDL.Type> = {};
    for (const f of node.fields) obj[f.name] = toIDL(f.ty, aliases, seen);
    return IDL.Record(obj);
  }

  if (node.k === "variant") {
    const obj: Record<string, IDL.Type> = {};
    for (const a of node.alts) obj[a.name] = toIDL(a.ty, aliases, seen);
    return IDL.Variant(obj);
  }

  return IDL.Reserved;
}

export function extractMethodSigs(didText: string): MethodSig[] {
  const { aliases, methodsRaw } = parseTypeAliasesAndService(didText);

  const out: MethodSig[] = methodsRaw.map((m) => {
    const argTypes = m.args.map((t) => toIDL(t, aliases));
    const retTypes = m.rets.map((t) => toIDL(t, aliases));
    return { name: m.name, kind: m.kind, argTypes, retTypes, sigLine: m.sigLine };
  });

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
