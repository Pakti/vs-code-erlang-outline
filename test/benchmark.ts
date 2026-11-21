import { analyze } from '../src/analysis';
import { parseRegions } from '../src/regions';
import { buildStructure, SourceSymbol } from '../src/structure';

const lines = Array.from({ length: 2500 }, (_, index) => [
  '%% region -- group ' + index, 'f' + index + '() -> ok.', '%% endregion -- group', '% separator',
]).flat();
const text = lines.join('\n');
const samples = [];
for (let run = 0; run < 11; run++) {
  const start = performance.now();
  const regions = parseRegions(text);
  const regionTime = performance.now();
  const analysis = analyze(text);
  const analysisTime = performance.now();
  const symbols: SourceSymbol[] = analysis.declarations.map(d => ({
    name: d.name, kind: 11, start: d.start, end: d.end, anchor: d.anchor,
    navigationStart: d.anchor, navigationEnd: d.nameEnd, children: [],
  }));
  buildStructure('file:///benchmark.erl', symbols, regions.roots);
  const end = performance.now();
  if (run) samples.push([regionTime - start, analysisTime - regionTime, end - analysisTime, end - start]);
}
const names = ['region', 'export', 'tree', 'total'];
console.log(lines.length + ' lines, milliseconds (median / max):');
for (const [column, name] of names.entries()) {
  const values = samples.map(sample => sample[column]).sort((a, b) => a - b);
  console.log(name + ' ' + ((values[4] + values[5]) / 2).toFixed(2) + ' / ' + values.at(-1)?.toFixed(2));
}
