import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { analyze } from '../src/analysis';
import { parseRegions } from '../src/regions';
import { buildStructure, currentNode, SourceSymbol } from '../src/structure';

test('orders every depth, retains children, and keeps identities across inserted lines', () => {
  function fixture(prefix = '') {
    const source = prefix + [
      'z() -> ok.', '%% region -- outer', 'm() -> ok.', '%% region -- inner',
      'a() -> ok.', '%% endregion -- inner', '%% endregion -- outer', 'b() -> ok.',
    ].join('\n');
    const symbols: SourceSymbol[] = analyze(source).declarations.reverse().map(d => ({
      name: d.name, kind: 11, start: d.start, end: d.end, navigationStart: d.anchor,
      navigationEnd: d.nameEnd, anchor: d.anchor, semanticKey: d.name, children: [],
    }));
    const owner = symbols.find(symbol => symbol.name === 'a')!;
    owner.children = [
      { ...owner, name: 'body', anchor: owner.anchor + 5, start: owner.start + 5, children: [] },
      { ...owner, name: 'head', end: owner.start + 4, children: [] },
    ];
    return { source, tree: buildStructure('untitled:sample', symbols, parseRegions(source).roots) };
  }
  const { source, tree } = fixture();
  assert.deepEqual(tree.map(node => node.label), ['z', 'outer', 'b']);
  assert.deepEqual(tree[1].children.map(node => node.label), ['m', 'inner']);
  const inner = tree[1].children[1];
  const fn = inner.children[0];
  assert.deepEqual(fn.children.map(node => node.label), ['head', 'body']);
  assert.equal(fn.parent, inner);
  assert.equal(currentNode(tree, source.indexOf('a()') + 7)?.label, 'body');
  assert.equal(currentNode(tree, source.indexOf('%% region -- inner'))?.label, 'inner');
  assert.equal(fixture('% inserted\n').tree[1].children[1].children[0].id, fn.id);
});

test('a marker inside a function preserves its owner and reports a boundary warning', () => {
  const text = '%% region -- outer\nf() ->\n%% region -- inner\nok\n%% endregion -- inner\n%% endregion -- outer\n.';
  const [d] = analyze(text).declarations;
  const symbol: SourceSymbol = {
    name: d.name, kind: 11, start: d.start, end: d.end, anchor: d.anchor,
    navigationStart: d.anchor, navigationEnd: d.nameEnd, children: [],
  };
  const [outer] = buildStructure('untitled:sample', [symbol], parseRegions(text).roots);
  assert.deepEqual(outer.children.map(node => node.label), ['f', 'inner']);
  assert.match(outer.children[0].warnings.join(), /boundary/);
  assert.match(outer.children[1].warnings.join(), /inside a declaration/);
});
