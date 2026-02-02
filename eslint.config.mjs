import antfu from '@antfu/eslint-config'

export default antfu({
  react: true,
  typescript: true,
  stylistic: {
    indent: 2,
    quotes: 'single',
    semi: false,
  },
  jsonc: false,
  toml: false,
  markdown: false,
  ignores: [
    'dist',
    'src-tauri/target',
    'src-tauri/gen',
    'node_modules',
    '.claude',
    '*.md',
  ],
}, {
  rules: {
    'no-console': 'warn',
    'react-hooks/exhaustive-deps': 'warn',
    'ts/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'react-refresh/only-export-components': 'off',
    'node/prefer-global/process': 'off',
  },
})
