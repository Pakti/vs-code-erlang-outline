export type Visibility = 'exported' | 'private' | 'unknown';
interface Token { kind: string; value: string; start: number; end: number }
export interface Declaration {
  kind: 'function' | 'type' | 'record';
  name: string;
  arity?: number;
  start: number;
  end: number;
  anchor: number;
  nameEnd: number;
}
export interface Analysis {
  declarations: Declaration[];
  uncertain: boolean;
  visibility(declaration: Declaration): Visibility;
}

function lex(text: string): { tokens: Token[]; incomplete: boolean } {
  const tokens: Token[] = [];
  let incomplete = false;
  let i = 0;
  const word = /[A-Za-z_@0-9\u0080-\uffff]+/y;
  while (i < text.length) {
    const start = i;
    const char = text[i++];
    let kind = char;
    let value = char;
    if (/\s/.test(char)) continue;
    if (char === '%') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (char === "'" || char === '"' || char === '$') {
      kind = char === "'" ? 'atom' : 'literal';
      let delimiter = char;
      value = '';
      if (char === '"' && text.startsWith('""', i)) {
        while (text[i] === '"') i++;
        delimiter = text.slice(start, i);
      }
      let closed = false;
      while (i < text.length) {
        if (char !== '$' && text.startsWith(delimiter, i)) {
          i += delimiter.length;
          closed = true;
          break;
        }
        const next = text[i++];
        if (next === '\\') {
          const escaped = /^(?:x\{([0-9a-fA-F]+)\}|x([0-9a-fA-F]{2})|([0-7]{1,3})|\^(.?)|(.))/s.exec(text.slice(i));
          if (!escaped) break;
          i += escaped[0].length;
          const point = escaped[1] || escaped[2] ? parseInt(escaped[1] || escaped[2], 16)
            : escaped[3] ? parseInt(escaped[3], 8)
            : escaped[4] ? escaped[4].charCodeAt(0) & 31 : undefined;
          const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', e: '\x1b', s: ' ', d: '\x7f' };
          if (point !== undefined) {
            if (point > 0x10ffff) incomplete = true;
            else value += String.fromCodePoint(point);
          } else value += escapes[escaped[5]] ?? escaped[5];
        } else value += next;
        if (char === '$') {
          closed = true;
          break;
        }
      }
      incomplete ||= !closed;
    } else {
      word.lastIndex = start;
      const match = word.exec(text);
      if (match) {
        value = match[0];
        i = word.lastIndex;
        kind = /^[a-zà-öø-ÿ]/.test(value) ? 'atom' : /^\d+$/.test(value) ? 'integer' : 'word';
      } else {
        const pair = text.slice(start, start + 2);
        if (['->', '<<', '>>'].includes(pair)) {
          kind = value = pair;
          i++;
        } else if (char === '.' && (i === text.length || /[\s%]/.test(text[i]))) {
          kind = 'terminator';
        }
      }
    }
    tokens.push({ kind, value, start, end: i });
  }
  return { tokens, incomplete };
}

const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}', '<<': '>>' };
const closingKinds = new Set(Object.values(pairs));

function groups(tokens: Token[], start: number, close: string): { items: Token[][]; last: number } | undefined {
  const stack: string[] = [];
  const items: Token[][] = [];
  let current: Token[] = [];
  for (let i = start; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.kind === close && stack.length === 0) {
      if (current.length || items.length) items.push(current);
      return { items, last: i };
    }
    if (token.kind === ',' && stack.length === 0) {
      items.push(current);
      current = [];
      continue;
    }
    if (pairs[token.kind]) stack.push(pairs[token.kind]);
    if (closingKinds.has(token.kind) && stack.pop() !== token.kind) return undefined;
    current.push(token);
  }
  return undefined;
}

function identity(name: string, arity: number): string {
  return JSON.stringify([name, arity]);
}

export function analyze(text: string): Analysis {
  const { tokens, incomplete } = lex(text);
  const declarations: Declaration[] = [];
  const exported = new Set<string>();
  let exportAll = false;
  let uncertain = incomplete;
  let conditional = false;
  let conditionDepth = 0;
  let formStart = 0;
  const stack: string[] = [];
  for (const [index, token] of tokens.entries()) {
    if (pairs[token.kind]) stack.push(pairs[token.kind]);
    if (closingKinds.has(token.kind) && stack.pop() !== token.kind) uncertain = true;
    if (token.kind !== 'terminator' || stack.length) continue;
    const form = tokens.slice(formStart, index);
    formStart = index + 1;
    const first = form[0];
    if (!first) {
      uncertain = true;
      continue;
    }
    if (first.kind === '-') {
      const attribute = form[1]?.value;
      if (['ifdef', 'ifndef', 'if'].includes(attribute)) {
        conditionDepth++;
        conditional = uncertain = true;
      } else if (attribute === 'endif') {
        if (conditionDepth) conditionDepth--;
        else uncertain = true;
      } else if (['else', 'elif', 'include', 'include_lib'].includes(attribute)) {
        uncertain = true;
      } else if (attribute === 'export' || attribute === 'compile') {
        if (form[2]?.kind !== '(' || form.at(-1)?.kind !== ')') {
          uncertain = true;
          continue;
        }
        const body = form.slice(3, -1);
        const list = body[0]?.kind === '[' ? groups(body, 1, ']') : undefined;
        const literalList = list && list.last === body.length - 1 ? list.items : undefined;
        if (attribute === 'export') {
          if (!literalList) uncertain = true;
          for (const item of literalList ?? []) {
            const [name, slash, arity] = item;
            if (item.length !== 3 || name.kind !== 'atom' || slash.kind !== '/' || arity.kind !== 'integer') {
              uncertain = true;
            } else if (!conditionDepth) {
              exported.add(identity(name.value, Number(arity.value)));
            }
          }
        } else {
          const options = literalList ?? [body];
          for (const option of options) {
            if (option.length === 1 && option[0].kind === 'atom' && option[0].value === 'export_all') {
              if (!conditionDepth) exportAll = true;
            }
            if (!option.length || option.some(entry => entry.kind === '?' || entry.value === 'parse_transform')) uncertain = true;
          }
        }
      } else if (attribute === 'type' || attribute === 'opaque' || attribute === 'record' || attribute === 'nominal') {
        const name = form[attribute === 'record' ? 3 : 2];
        if (name?.kind === 'atom') {
          declarations.push({ kind: attribute === 'record' ? 'record' : 'type', name: name.value,
            start: first.start, end: token.end, anchor: name.start, nameEnd: name.end });
        }
      }
    } else if (first.kind === 'atom' && form[1]?.kind === '(') {
      const args = groups(form, 2, ')');
      const after = args && form[args.last + 1];
      if (args && args.items.every(item => item.length > 0) && (after?.kind === '->' || after?.value === 'when')
          && form.some(entry => entry.kind === '->') && form.at(-1)?.kind !== '->') {
        declarations.push({ kind: 'function', name: first.value, arity: args.items.length,
          start: first.start, end: token.end, anchor: first.start, nameEnd: first.end });
      } else uncertain = true;
    } else uncertain = true;
  }
  uncertain ||= formStart !== tokens.length || conditionDepth !== 0;
  return {
    declarations,
    uncertain,
    visibility(declaration) {
      if (declaration.kind !== 'function' || declaration.arity === undefined) return 'unknown';
      if (exportAll || exported.has(identity(declaration.name, declaration.arity))) return 'exported';
      return uncertain || conditional ? 'unknown' : 'private';
    },
  };
}
