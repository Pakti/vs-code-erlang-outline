import * as vscode from 'vscode';
import { Analysis, Declaration } from './analysis';
import { SourceSymbol } from './structure';

type ProviderSymbol = vscode.DocumentSymbol | vscode.SymbolInformation;

export function normalize(
  document: vscode.TextDocument,
  results: readonly ProviderSymbol[],
  analysis: Analysis,
  warn: (message: string) => void,
): SourceSymbol[] {
  const uri = document.uri.toString();
  const length = document.getText().length;
  const roots: SourceSymbol[] = [];
  const flat: SourceSymbol[] = [];
  const declarations = analysis.declarations;
  const functionKind = vscode.SymbolKind.Function;
  const kindFor = (kind: number) => kind === functionKind ? 'function'
    : kind === vscode.SymbolKind.Struct || kind === vscode.SymbolKind.Class ? 'record'
    : kind === vscode.SymbolKind.TypeParameter || kind === vscode.SymbolKind.Interface ? 'type' : undefined;

  function locate(position: number): Declaration | undefined {
    let low = 0;
    let high = declarations.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (declarations[mid].start <= position) low = mid + 1;
      else high = mid;
    }
    const candidate = declarations[low - 1];
    return candidate && candidate.end > position ? candidate : undefined;
  }

  function valid(range: vscode.Range): boolean {
    return document.validateRange(range).isEqual(range);
  }

  function convert(item: ProviderSymbol, parentDeclaration?: Declaration): SourceSymbol | undefined {
    const hierarchical = 'selectionRange' in item;
    if (!hierarchical && item.location.uri.toString() !== uri) {
      warn('Skipped a symbol in another document');
      return;
    }
    const range = hierarchical ? item.range : item.location.range;
    const selection = hierarchical ? item.selectionRange : range;
    if (!valid(range) || !valid(selection) || !range.contains(selection)) {
      warn('Skipped a symbol with an invalid range');
      return;
    }
    const start = document.offsetAt(range.start);
    const end = document.offsetAt(range.end);
    const navigationStart = document.offsetAt(selection.start);
    const navigationEnd = document.offsetAt(selection.end);
    const candidate = locate(navigationStart) ?? locate(start);
    const declaration = candidate?.kind === kindFor(item.kind) && candidate !== parentDeclaration
      ? candidate : undefined;
    const semanticKey = declaration && JSON.stringify([declaration.kind, declaration.name, declaration.arity]);
    const symbol: SourceSymbol = {
      name: item.name, kind: item.kind, detail: hierarchical ? item.detail : undefined,
      start: declaration?.start ?? start, end: declaration?.end ?? end, anchor: declaration?.anchor ?? navigationStart,
      navigationStart: declaration?.anchor ?? navigationStart, navigationEnd: declaration?.nameEnd ?? navigationEnd,
      semanticKey, children: [],
      visibility: item.kind === functionKind ? declaration ? analysis.visibility(declaration) : 'unknown' : undefined,
    };
    if (hierarchical) {
      for (const child of item.children) {
        const converted = convert(child, declaration ?? parentDeclaration);
        if (!converted) continue;
        if (symbol.start <= converted.start && converted.end <= symbol.end) symbol.children.push(converted);
        else flat.push(converted);
      }
    }
    return symbol;
  }

  function add(siblings: SourceSymbol[], node: SourceSymbol, index: Map<string, SourceSymbol>): void {
    const key = node.semanticKey
      ? JSON.stringify([node.semanticKey, node.anchor])
      : JSON.stringify([node.kind, node.name, node.start, node.end, node.navigationStart, node.navigationEnd]);
    const existing = index.get(key);
    if (existing) {
      existing.detail ||= node.detail;
      const children = new Map<string, SourceSymbol>();
      const combined = [...existing.children, ...node.children];
      existing.children = [];
      for (const child of combined) add(existing.children, child, children);
    } else {
      index.set(key, node);
      siblings.push(node);
      const children = node.children;
      node.children = [];
      const childIndex = new Map<string, SourceSymbol>();
      for (const child of children) add(node.children, child, childIndex);
    }
  }

  const index = new Map<string, SourceSymbol>();
  const hierarchical: SourceSymbol[] = [];
  for (const result of results) {
    const symbol = convert(result);
    if (!symbol) continue;
    if ('selectionRange' in result) hierarchical.push(symbol);
    else flat.push(symbol);
  }
  const wrappers = hierarchical.filter(symbol => symbol.start === 0 && symbol.end === length && symbol.children.length
    && [vscode.SymbolKind.File, vscode.SymbolKind.Module, vscode.SymbolKind.Namespace].includes(symbol.kind));
  for (const original of hierarchical) {
    const symbols = wrappers.length === 1 && original === wrappers[0] ? original.children : [original];
    for (const symbol of symbols) add(roots, symbol, index);
  }

  const all: SourceSymbol[] = [];
  function collect(symbol: SourceSymbol): void {
    all.push(symbol);
    for (const child of symbol.children) collect(child);
  }
  for (const root of roots) collect(root);
  flat.sort((a, b) => a.start - b.start || b.end - a.end);
  for (const node of flat) {
    // Prefer matching existing hierarchy anywhere in the tree.
    const equivalent = all.find(other => other.semanticKey && other.semanticKey === node.semanticKey && other.anchor === node.anchor
      || other.kind === node.kind && other.name === node.name && other.start === node.start && other.end === node.end
        && other.navigationStart === node.navigationStart && other.navigationEnd === node.navigationEnd);
    if (equivalent) continue;
    let parent: SourceSymbol | undefined;
    for (const other of all) {
      if (other.start <= node.start && other.end >= node.end && other.end - other.start > node.end - node.start
          && (!parent || other.end - other.start < parent.end - parent.start)) parent = other;
    }
    if (parent) parent.children.push(node);
    else roots.push(node);
    collect(node);
  }
  return roots;
}
