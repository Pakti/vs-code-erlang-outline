# Erlang Structure

Erlang Structure adds a native Explorer view for the active Erlang buffer. It respects source order, groups declarations by explicit region markers, and colors the same function glyph differently for exported, private, and unresolved functions.

## Install and use

Use VS Code 1.90 or later. In the Extensions view, open the **…** menu and choose **Install from VSIX…**, then select `erlang-structure.vsix`. You can also run `code --install-extension erlang-structure.vsix`.

Open an Erlang document and expand **Erlang Structure** in Explorer. Symbol discovery uses the document symbol providers already installed in VS Code, such as Erlang Language Platform or pgourlain.erlang. The region tree also works when no provider supplies symbols. Unsaved buffers, untitled documents assigned the Erlang language, and remote document URIs use the same view.

Select a symbol or region to navigate to its declaration or marker. Use the disclosure arrow to expand a region without navigating. Navigation uses VS Code's preview option and may reuse an already-open editor. Explorer supplies keyboard navigation and type-to-find. The toolbar includes **Refresh**, **Collapse All**, **Toggle Follow Cursor**, and **Reveal Current Symbol**. Follow Cursor starts enabled and is remembered. Automatic reveal leaves editor focus where it is.

## Region markers

```erlang
%% region -- Public API
start() -> ok.
%% endregion -- any label
```

The opening regex is `/^%% region -- (.*)/` and requires the marker at the start of its physical line. The closing regex is `/%% endregion -- .*/` and also matches after preceding characters. Closing labels need not match. If both patterns match on one line, the opening marker wins. The scanner applies the patterns to the literal contents of each line, including lines inside multiline strings. Nesting, duplicate labels, and empty regions are supported. An unclosed region extends to the end of the file and an unmatched close is logged. A declaration that crosses a boundary stays intact. Markers within a declaration do not move clauses or other children out of their owning symbol.

## Settings and diagnostics

Under `workbench.colorCustomizations`, override `erlangStructure.exportedFunctionForeground`, `erlangStructure.privateFunctionForeground`, or `erlangStructure.unknownFunctionForeground`. Visibility also appears in tooltips and accessibility labels. Follow Cursor is a persisted command preference.

The lexer recognizes literal export declarations and literal `export_all`. Includes, conditionals, parse transforms, unresolved macros, and incomplete source can leave visibility unknown. The extension does not run the Erlang preprocessor. The **Erlang Structure** output channel reports marker warnings, unresolved visibility, and provider issues. Use **Refresh** if the language provider takes longer to initialize than the bounded startup retries. This view uses VS Code's public symbol command, which does not expose a provider selector. Provider results determine the available symbols and hierarchy.

## Develop and test

From the repository root, with Node.js 22 or newer and npm:

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run benchmark
npm run package
```

Run `npm run build` before starting the **Run Erlang Structure** launch configuration with F5. For automated Extension Development Host checks, run `npm run test:integration` from a graphical desktop session. This downloads VS Code 1.90.2 and uses controlled fake providers.

For a desktop compatibility check, use a real Erlang module with nested regions, an exported function, a private function, and a declaration with unresolved visibility. Test with Erlang Language Platform enabled alone, pgourlain.erlang enabled alone, and both enabled. Record the VS Code and extension versions, any duplicate declarations, and any provider-specific behavior. In light, dark, high contrast dark, and high contrast light themes, check that the icons share a glyph and that all three colors are readable. Confirm the visibility labels with a screen reader, follow-cursor behavior with a split editor, and expansion retention after inserting a line above a declaration.
