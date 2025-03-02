export default {
  quoteProps: 'consistent',
  bracketSpacing: true,
  semi: false,
  trailingComma: 'es5',
  useTabs: false,
  tabWidth: 2,
  singleQuote: true,
  arrowParens: 'avoid',
  proseWrap: 'always',
  overrides: [
    {
      files: ['*.njk', '*.html'],
      options: {
        parser: 'html',
        htmlWhitespaceSensitivity: 'css',
        singleQuote: false,
        printWidth: 100,
        tabWidth: 2,
      },
    },
  ],
}
