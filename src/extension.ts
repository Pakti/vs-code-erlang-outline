import * as vscode from 'vscode';
import { analyze } from './analysis';
import { parseRegions } from './regions';
import { buildStructure, currentNode, StructureNode } from './structure';
import { normalize } from './symbols';

const kindIcons = new Map([
  [vscode.SymbolKind.Module, 'module'], [vscode.SymbolKind.Namespace, 'namespace'],
  [vscode.SymbolKind.Class, 'class'], [vscode.SymbolKind.Struct, 'struct'],
  [vscode.SymbolKind.Field, 'field'], [vscode.SymbolKind.Variable, 'variable'],
  [vscode.SymbolKind.Constant, 'constant'], [vscode.SymbolKind.Interface, 'interface'],
  [vscode.SymbolKind.TypeParameter, 'type-parameter'], [vscode.SymbolKind.Method, 'method'],
  [vscode.SymbolKind.Property, 'property'], [vscode.SymbolKind.Enum, 'enum'],
  [vscode.SymbolKind.EnumMember, 'enum-member'], [vscode.SymbolKind.String, 'string'],
  [vscode.SymbolKind.Number, 'number'], [vscode.SymbolKind.Boolean, 'boolean'],
  [vscode.SymbolKind.File, 'file'], [vscode.SymbolKind.Package, 'package'],
  [vscode.SymbolKind.Array, 'array'], [vscode.SymbolKind.Object, 'object'],
  [vscode.SymbolKind.Key, 'key'], [vscode.SymbolKind.Operator, 'operator'],
  [vscode.SymbolKind.Event, 'event'], [vscode.SymbolKind.Constructor, 'constructor'],
  [vscode.SymbolKind.Null, 'null'],
]);

export class StructureProvider implements vscode.TreeDataProvider<StructureNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  roots: StructureNode[] = [];

  update(roots: StructureNode[]): void {
    this.roots = roots;
    this.changed.fire();
  }
  getChildren(node?: StructureNode): StructureNode[] {
    return node?.children ?? this.roots;
  }
  getParent(node: StructureNode): StructureNode | undefined {
    return node.parent;
  }
  getTreeItem(node: StructureNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, node.region || node.children.length
      ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    item.id = node.id;
    const visibility = node.symbol?.visibility;
    item.iconPath = visibility
      ? new vscode.ThemeIcon('symbol-function', new vscode.ThemeColor('erlangStructure.' + visibility + 'FunctionForeground'))
      : new vscode.ThemeIcon('symbol-' + (node.region ? 'namespace' : kindIcons.get(node.symbol?.kind ?? -1) ?? 'misc'));
    const visibilityText = visibility === 'unknown'
      ? 'Export visibility unknown: the declaration or export set could not be resolved from this document.'
      : visibility === 'exported' ? 'Exported function' : visibility === 'private' ? 'Private function' : undefined;
    item.tooltip = [node.label, node.symbol?.detail, visibilityText, ...node.warnings].filter(Boolean).join('\n');
    item.accessibilityInformation = { label: [node.label, visibilityText].filter(Boolean).join(', ') };
    item.command = { command: 'erlangStructure.navigate', title: 'Go to declaration', arguments: [node] };
    return item;
  }
  dispose(): void {
    this.changed.dispose();
  }
}

const id = 'erlangStructure';
const retryDelays = [400, 1200, 3000];
type ProviderResult = Array<vscode.DocumentSymbol | vscode.SymbolInformation>;

export function activate(context: vscode.ExtensionContext) {
  const provider = new StructureProvider();
  const view = vscode.window.createTreeView(id, { treeDataProvider: provider, showCollapseAll: true });
  const output = vscode.window.createOutputChannel('Erlang Structure');
  let active = vscode.window.activeTextEditor;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let due = false;
  let dirty = true;
  let disposed = false;
  let retries = 0;
  let follow = context.globalState.get('followCursor', true);
  let result: { uri: string; version: number } | undefined;
  let lastWarning = '';

  function document(): vscode.TextDocument | undefined {
    return active?.document.languageId === 'erlang' ? active.document : undefined;
  }
  function isCurrent(node: StructureNode): boolean {
    const doc = document();
    return !!doc && result?.uri === doc.uri.toString() && result.version === doc.version
      && node.id.startsWith(result.uri + '/');
  }
  function reveal(): void {
    const doc = document();
    if (!view.visible || !active || !doc) return;
    const node = currentNode(provider.roots, doc.offsetAt(active.selection.active));
    if (node && isCurrent(node)) {
      void view.reveal(node, { select: true, focus: false }).then(undefined, () => undefined);
    }
  }
  function schedule(delay = 0): void {
    clearTimeout(timer);
    due = false;
    dirty = true;
    if (!view.visible || !document() || disposed) return;
    timer = setTimeout(() => { timer = undefined; due = true; void rebuild(); }, delay);
  }
  function invalidate(delay = 0): void {
    generation++;
    retries = 0;
    schedule(delay);
  }
  async function rebuild(): Promise<void> {
    const doc = document();
    if (inFlight || !due || !doc || !view.visible || disposed) return;
    const uri = doc.uri.toString();
    const version = doc.version;
    const request = generation;
    const source = doc.getText();
    due = false;
    inFlight = true;
    try {
      let symbols: ProviderResult | undefined;
      let failed = false;
      try {
        symbols = await vscode.commands.executeCommand<ProviderResult>('vscode.executeDocumentSymbolProvider', doc.uri);
      } catch {
        failed = true;
      }
      if (disposed || !view.visible || request !== generation || doc !== document() || version !== doc.version) return;
      const diagnostics = new Set<string>();
      const analysis = analyze(source);
      const regions = parseRegions(source);
      for (const warning of regions.warnings) diagnostics.add('Line ' + (warning.line + 1) + ': ' + warning.message);
      const nodes = buildStructure(uri, normalize(doc, symbols ?? [], analysis, message => diagnostics.add(message)), regions.roots);

      function warn(nodes: StructureNode[], document: vscode.TextDocument): void {
        for (const node of nodes) {
          for (const warning of node.warnings) {
            diagnostics.add('Line ' + (document.positionAt(node.anchor).line + 1) + ': ' + warning);
          }
          if (node.symbol?.visibility === 'unknown') {
            diagnostics.add('Export analysis could not resolve all visibility from this buffer.');
          }
          warn(node.children, document);
        }
      }
      warn(nodes, doc);
      const status = failed ? 'Erlang symbol provider failed. Try Refresh.'
        : !symbols?.length ? 'No symbols returned. Check your Erlang symbol provider or try Refresh.' : undefined;
      if (status) diagnostics.add(status);
      const warnings = [...diagnostics].join('\n');
      if (warnings && warnings !== lastWarning) output.appendLine(warnings);
      lastWarning = warnings;
      result = { uri, version };
      dirty = false;
      view.message = status;
      provider.update(nodes);
      if (follow) reveal();
      if (status && retries < retryDelays.length) schedule(retryDelays[retries++]);
    } catch (error) {
      if (request === generation && !disposed) {
        dirty = true;
        view.message = 'Could not update Erlang Structure. Try Refresh.';
        output.appendLine('Could not update Erlang Structure: ' + (error instanceof Error ? error.name : 'Unexpected error'));
      }
    } finally {
      inFlight = false;
      if (due) void rebuild();
    }
  }
  function switchEditor(editor: vscode.TextEditor | undefined): void {
    const previous = document();
    active = editor;
    const next = document();
    view.description = next?.uri.path.split('/').at(-1);
    void vscode.commands.executeCommand('setContext', id + '.hasDocument', !!next);
    if (previous !== next || !result) {
      result = undefined;
      view.message = undefined;
      lastWarning = '';
      provider.update([]);
      invalidate();
    } else if (follow) reveal();
  }
  context.subscriptions.push(provider, view, output, {
    dispose() { disposed = true; clearTimeout(timer); },
  },
  vscode.window.onDidChangeActiveTextEditor(switchEditor),
  vscode.workspace.onDidChangeTextDocument(event => {
    if (event.document === document() && event.contentChanges.length) invalidate(250);
  }),
  vscode.workspace.onDidSaveTextDocument(doc => { if (doc === document()) invalidate(); }),
  vscode.workspace.onDidChangeConfiguration(() => { if (document()) invalidate(); }),
  vscode.window.onDidChangeTextEditorSelection(event => { if (follow && event.textEditor === active) reveal(); }),
  view.onDidChangeVisibility(event => {
    if (!event.visible) {
      generation++;
      clearTimeout(timer);
      due = false;
      dirty ||= inFlight;
    } else if (dirty || !result) schedule();
    else if (follow) reveal();
  }),
  vscode.commands.registerCommand(id + '.refresh', () => invalidate()),
  vscode.commands.registerCommand(id + '.follow', async () => {
    follow = !follow;
    await context.globalState.update('followCursor', follow);
    view.badge = follow ? undefined : { value: 0, tooltip: 'Follow Cursor is off' };
    if (follow) reveal();
  }),
  vscode.commands.registerCommand(id + '.reveal', reveal),
  vscode.commands.registerCommand(id + '.navigate', async (node: StructureNode) => {
    if (!active || !isCurrent(node)) return;
    const doc = active.document;
    const selection = new vscode.Range(doc.positionAt(node.navigationStart), doc.positionAt(node.navigationEnd));
    await vscode.window.showTextDocument(doc, { viewColumn: active.viewColumn, selection, preview: true });
  }));
  if (!follow) view.badge = { value: 0, tooltip: 'Follow Cursor is off' };
  switchEditor(active);
  return { provider };
}
