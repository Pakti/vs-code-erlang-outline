import { type Visibility } from './analysis';
import { type Region } from './regions';

export interface SourceSymbol {
  name: string;
  kind: number;
  detail?: string;
  start: number;
  end: number;
  navigationStart: number;
  navigationEnd: number;
  anchor: number;
  semanticKey?: string;
  visibility?: Visibility;
  children: SourceSymbol[];
}

export interface StructureNode {
  id: string;
  label: string;
  start: number;
  end: number;
  anchor: number;
  navigationStart: number;
  navigationEnd: number;
  children: StructureNode[];
  parent?: StructureNode;
  symbol?: SourceSymbol;
  region?: Region;
  warnings: string[];
}

export function buildStructure(uri: string, symbols: SourceSymbol[], regions: Region[]): StructureNode[] {
  const roots: StructureNode[] = [];
  const regionNodes = new Map<Region, StructureNode>();
  function addRegion(region: Region, parent?: StructureNode): void {
    const node: StructureNode = {
      id: '', label: region.label || '(unnamed region)', anchor: region.markerStart, start: region.markerStart,
      end: region.end, navigationStart: region.markerStart, navigationEnd: region.markerEnd, region,
      children: [], parent, warnings: region.closingLine === undefined ? ['Unclosed region'] : [],
    };
    regionNodes.set(region, node);
    (parent?.children ?? roots).push(node);
    for (const child of region.children) addRegion(child, node);
  }
  for (const region of regions) addRegion(region);

  function atOffset(siblings: Region[], offset: number): Region | undefined {
    let lo = 0;
    let hi = siblings.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (siblings[mid].contentStart <= offset) lo = mid + 1;
      else hi = mid;
    }
    const candidate = siblings[lo - 1];
    if (!candidate || offset >= candidate.contentEnd) return undefined;
    return atOffset(candidate.children, offset) ?? candidate;
  }

  const boundaries = [...regionNodes.keys()].flatMap(region => [region.contentStart, region.contentEnd])
    .sort((a, b) => a - b);
  function crossesBoundary(start: number, end: number): boolean {
    let low = 0;
    let high = boundaries.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (boundaries[middle] <= start) low = middle + 1;
      else high = middle;
    }
    return low < boundaries.length && boundaries[low] < end;
  }

  function addSymbol(symbol: SourceSymbol, parent?: StructureNode): void {
    const warnings: string[] = [];
    const region = parent?.region;
    if (!parent?.symbol && (crossesBoundary(symbol.start, symbol.end)
        || (region && symbol.end > region.contentEnd))) {
      warnings.push('Declaration crosses a region boundary');
    }
    const node: StructureNode = {
      id: '', label: symbol.name, start: symbol.start, end: symbol.end, anchor: symbol.anchor,
      navigationStart: symbol.navigationStart, navigationEnd: symbol.navigationEnd, symbol, children: [],
      parent, warnings,
    };
    (parent?.children ?? roots).push(node);
    for (const child of symbol.children) addSymbol(child, node);
  }

  const declarations = [...symbols].sort((a, b) => a.start - b.start);
  const markers = [...regionNodes.values()].sort((a, b) => a.start - b.start);
  let cursor = 0;
  let owner: SourceSymbol | undefined;
  for (const marker of markers) {
    while (cursor < declarations.length && declarations[cursor].start < marker.start) {
      const declaration = declarations[cursor++];
      if (!owner || declaration.end >= owner.end) owner = declaration;
    }
    if (owner && marker.start < owner.end) {
      marker.warnings.push('Region marker inside a declaration');
    }
  }
  for (const symbol of symbols) {
    const region = atOffset(regions, symbol.anchor);
    addSymbol(symbol, region && regionNodes.get(region));
  }

  function assignIds(siblings: StructureNode[], prefix: string): void {
    siblings.sort((a, b) => a.anchor - b.anchor || a.start - b.start || a.end - b.end
      || (a.symbol?.kind ?? -1) - (b.symbol?.kind ?? -1) || a.label.localeCompare(b.label, 'en'));
    const occurrences = new Map<string, number>();
    for (const node of siblings) {
      const key = JSON.stringify(node.region ? ['region', node.region.label]
        : ['symbol', node.symbol?.kind, node.symbol?.semanticKey ?? node.label]);
      const occurrence = occurrences.get(key) ?? 0;
      occurrences.set(key, occurrence + 1);
      node.id = prefix + '/' + encodeURIComponent(key) + '/' + occurrence;
      assignIds(node.children, node.id);
    }
  }
  assignIds(roots, uri);
  return roots;
}

export function currentNode(roots: StructureNode[], offset: number): StructureNode | undefined {
  let bestSymbol: StructureNode | undefined;
  let bestRegion: StructureNode | undefined;
  let symbolDepth = -1;
  let regionDepth = -1;
  function visit(node: StructureNode, depth: number): void {
    const inside = node.start <= offset && offset < node.end;
    if (inside && node.symbol && depth > symbolDepth) {
      bestSymbol = node;
      symbolDepth = depth;
    } else if (inside && node.region && depth > regionDepth) {
      bestRegion = node;
      regionDepth = depth;
    }
    // A declaration can cross its parent region boundary.
    for (const child of node.children) visit(child, depth + 1);
  }
  for (const root of roots) visit(root, 0);
  return bestSymbol ?? bestRegion;
}
