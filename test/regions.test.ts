import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseRegions } from '../src/regions';

for (const newline of ['\n', '\r\n']) {
  test(`pairs textual markers with ${JSON.stringify(newline)} line endings`, () => {
    const text = [
      'prefix %% endregion -- stray',
      ' %% region -- ignored',
      '%% region --  outer  ',
      '%% region -- ',
      '%% endregion -- another name',
      '%% region -- same',
      '%% endregion -- first',
      '%% region -- same',
      '%% endregion -- second',
      'z() -> ok.',
      'prefix %% endregion -- mismatched',
      '"""',
      '%% region -- opens %% endregion -- too',
      '"""',
    ].join(newline);
    const { roots, warnings } = parseRegions(text);
    assert.equal(roots.length, 2);
    const [outer, unclosed] = roots;
    assert.equal(outer.label, ' outer  ');
    assert.equal(outer.openingLine, 2);
    assert.equal(outer.closingLine, 10);
    assert.deepEqual(outer.children.map(child => child.label), ['', 'same', 'same']);
    assert.equal(outer.children[0].contentStart, outer.children[0].contentEnd);
    assert.equal(text.slice(outer.markerStart, outer.markerEnd), '%% region --  outer  ');
    assert.equal(text.slice(outer.contentEnd, outer.end), 'prefix %% endregion -- mismatched' + newline);
    assert.equal(unclosed.label, 'opens %% endregion -- too');
    assert.equal(unclosed.closingLine, undefined);
    assert.equal(unclosed.end, text.length);
    assert.deepEqual(warnings.map(warning => warning.line), [0, 12]);
  });
}
