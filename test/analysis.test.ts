import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { analyze } from '../src/analysis';

function visibility(source: string) {
  const analysis = analyze(source);
  return analysis.declarations.filter(declaration => declaration.kind === 'function')
    .map(declaration => [declaration.name, declaration.arity, analysis.visibility(declaration)]);
}

test('literal exports use decoded name and arity and preserve complete clause chains', () => {
  const source = `-module(sample).
-export([z/0, % comment
         'a b'/1]).
-export(['a\\x{20}b'/2]).
z() -> ok.
'a b'(one) -> ok;
'a b'(two) -> ok.
'a b'(A,B) -> {A,B}.
'a b'() -> "-export(['a b'/0]).".
`;
  assert.deepEqual(visibility(source), [
    ['z', 0, 'exported'], ['a b', 1, 'exported'], ['a b', 2, 'exported'], ['a b', 0, 'private'],
  ]);
  const clause = analyze(source).declarations[1];
  assert.equal(source.slice(clause.start, clause.end), "'a b'(one) -> ok;\n'a b'(two) -> ok.");
});

test('ignores syntax in comments, quoted atoms, strings, multiline literals, and character literals', () => {
  assert.deepEqual(visibility(`% -compile(export_all).
z() -> {"-export([z/0]).", '-compile(export_all).', $%, $.}.
a() -> """
-export([a/0]).
-compile(export_all).
""".
`), [['z', 0, 'private'], ['a', 0, 'private']]);
});

for (const options of ['export_all', '[nowarn_export_all, export_all]']) {
  test('supports literal compile option ' + options, () => {
    assert.deepEqual(visibility('-compile(' + options + ').\nf() -> ok.'), [['f', 0, 'exported']]);
  });
}

for (const header of [
  '-export(?EXPORTS).', '-include("exports.hrl").', '-compile({parse_transform, export_helper}).',
  '-ifdef(TEST).\n-export([f/0]).\n-endif.', '-compile([?OPTIONS]).',
]) {
  test('marks uncertain visibility for ' + JSON.stringify(header), () => {
    assert.deepEqual(visibility(header + '\nf() -> ok.'), [['f', 0, 'unknown']]);
  });
}
test('incomplete syntax preserves proven exports and avoids guessing private visibility', () => {
  assert.deepEqual(visibility('-export([z/0]).\nz() -> ok.\na() -> ok.\nb() ->'), [
    ['z', 0, 'exported'], ['a', 0, 'unknown'],
  ]);
});
