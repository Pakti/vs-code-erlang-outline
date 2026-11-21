import { strict as assert } from 'node:assert';
import * as vscode from 'vscode';
import type { StructureProvider } from '../src/extension';
import type { StructureNode } from '../src/structure';

async function until<T>(check: () => T | undefined): Promise<T> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const value = check();
    if (value !== undefined) return value;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error('Timed out waiting for the Erlang Structure view');
}

export async function run(): Promise<void> {
  const commands = 'erlangStructure.';
  const extension = vscode.extensions.getExtension<{ provider: StructureProvider }>('Pakti.erlang-structure');
  assert.ok(extension);
  const { provider } = await extension.activate();
  const document = await vscode.workspace.openTextDocument({
    language: 'erlang',
    content: ['-export([z/0]).', 'z() -> ok.', '%% region -- Group', 'a() -> ok.', '%% endregion -- Group', 'm() -> ok.'].join('\n'),
  });
  const requestTimes: number[] = [];
  let requested: (() => void) | undefined;
  let defer: Promise<void> | undefined;
  const symbols = vscode.languages.registerDocumentSymbolProvider({ language: 'erlang', scheme: 'untitled' }, {
    async provideDocumentSymbols(doc) {
      if (doc !== document) return [];
      requestTimes.push(doc.version);
      requested?.();
      await defer;
      const names = ['a', 'm', 'z'];
      return names.map(name => {
        const offset = doc.getText().indexOf(name + '()');
        const start = doc.positionAt(offset);
        const selection = new vscode.Range(start, start.translate(0, 1));
        return new vscode.DocumentSymbol(name + '/0', 'fake provider', vscode.SymbolKind.Function,
          doc.lineAt(start).range, selection);
      });
    },
  });
  const flat = vscode.languages.registerDocumentSymbolProvider({ language: 'erlang', scheme: 'untitled' }, {
    provideDocumentSymbols(doc) {
      if (doc !== document) return [];
      const offset = doc.getText().indexOf('z()');
      const start = doc.positionAt(offset);
      return [new vscode.SymbolInformation('z', vscode.SymbolKind.Function, '',
        new vscode.Location(doc.uri, new vscode.Range(start, start.translate(0, 1))))];
    },
  });
  try {
    let editor = await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand(commands + 'focus');
    const roots = await until(() => provider.roots.length === 3 ? provider.roots : undefined);
    assert.deepEqual(roots.map(node => node.label), ['z/0', 'Group', 'm/0']);
    assert.deepEqual(roots[1].children.map(node => node.label), ['a/0']);
    for (const [node, visibility] of [[roots[0], 'exported'], [roots[1].children[0], 'private']] as const) {
      const item = provider.getTreeItem(node);
      assert.ok(item.iconPath instanceof vscode.ThemeIcon);
      assert.equal(item.iconPath.id, 'symbol-function');
      assert.deepEqual(item.iconPath.color, new vscode.ThemeColor('erlangStructure.' + visibility + 'FunctionForeground'));
      assert.match(item.accessibilityInformation?.label ?? '', new RegExp(visibility, 'i'));
    }

    await vscode.commands.executeCommand(commands + 'navigate', roots[1]);
    editor = vscode.window.activeTextEditor!;
    assert.equal(editor.document, document);
    assert.equal(editor.selection.start.line, 2);
    await vscode.commands.executeCommand(commands + 'navigate', roots[1].children[0]);
    assert.equal(editor.selection.start.line, 3);
    assert.equal(document.getText(editor.selection), 'a');

    const id = roots[0].id;
    await editor.edit(edit => edit.insert(new vscode.Position(0, 0), '% unsaved\n'));
    const shifted = await until(() => provider.roots[0]?.navigationStart > roots[0].navigationStart
      ? provider.roots[0] : undefined);
    assert.equal(shifted.id, id);
    await vscode.commands.executeCommand('undo');
    await until(() => provider.roots[0]?.navigationStart === roots[0].navigationStart ? true : undefined);
    await vscode.commands.executeCommand('redo');
    await until(() => provider.roots[0]?.navigationStart === shifted.navigationStart ? true : undefined);
    assert.ok(requestTimes.length >= 4);

    let finishRequest!: () => void;
    defer = new Promise(resolve => { finishRequest = resolve; });
    const started = new Promise<void>(resolve => { requested = resolve; });
    await vscode.commands.executeCommand(commands + 'refresh');
    await started;
    const plain = await vscode.workspace.openTextDocument({ language: 'plaintext', content: 'plain' });
    await vscode.window.showTextDocument(plain);
    await until(() => provider.roots.length === 0 ? true : undefined);
    finishRequest();
    defer = undefined;
    requested = undefined;
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(provider.roots.length, 0, 'A stale request must not repopulate the tree');
    await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside });
    const restored = await until<StructureNode>(() => provider.roots[0]);
    assert.equal(restored.id, id);
    await vscode.commands.executeCommand(commands + 'reveal');
    assert.equal(vscode.window.activeTextEditor?.document, document);
    console.log('Erlang Structure host integration checks passed.');
  } finally {
    flat.dispose();
    symbols.dispose();
  }
}
