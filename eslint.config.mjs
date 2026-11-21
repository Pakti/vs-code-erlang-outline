import tseslint from 'typescript-eslint';
export default [{ ignores: ['out/**', '.vscode-test/**'] }, ...tseslint.configs.recommended];
