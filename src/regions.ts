export interface Region {
  label: string;
  openingLine: number;
  closingLine?: number;
  contentStart: number;
  contentEnd: number;
  markerStart: number;
  markerEnd: number;
  end: number;
  children: Region[];
}

export interface RegionWarning {
  line: number;
  message: string;
}

const opening = /^%% region -- (.*)/;
const closing = /%% endregion -- .*/;

export function parseRegions(text: string): { roots: Region[]; warnings: RegionWarning[] } {
  const roots: Region[] = [];
  const warnings: RegionWarning[] = [];
  const stack: Region[] = [];
  const lines = text.split('\n');
  let offset = 0;
  for (const [lineNumber, physicalLine] of lines.entries()) {
    const hasNewline = lineNumber < lines.length - 1;
    const line = hasNewline && physicalLine.endsWith('\r')
      ? physicalLine.slice(0, -1)
      : physicalLine;
    const next = offset + physicalLine.length + Number(hasNewline);
    const match = opening.exec(line);
    if (match) {
      const region: Region = {
        label: match[1],
        openingLine: lineNumber,
        contentStart: next,
        contentEnd: text.length,
        markerStart: offset,
        markerEnd: offset + match[0].length,
        end: text.length,
        children: [],
      };
      (stack.at(-1)?.children ?? roots).push(region);
      stack.push(region);
    } else if (closing.test(line)) {
      const region = stack.pop();
      if (region) {
        region.closingLine = lineNumber;
        region.contentEnd = offset;
        region.end = next;
      } else {
        warnings.push({ line: lineNumber, message: 'Unmatched endregion marker' });
      }
    }
    offset = next;
  }
  for (const region of stack) {
    warnings.push({ line: region.openingLine, message: 'Unclosed region' });
  }
  return { roots, warnings };
}
