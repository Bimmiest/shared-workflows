import allowlist from './scripts/lint-allowlist.json' with { type: 'json' };

export default [
  {
    rules: {
      'no-console': 'error',
      // The check turns this on again with a severity alone, so the selector must stay.
      'no-restricted-syntax': ['error', { selector: "CallExpression[callee.name='alert']", message: 'No alert.' }],
    },
  },
  ...Object.entries(allowlist.files).map(([file, rules]) => ({
    files: [file],
    rules: Object.fromEntries(Object.keys(rules).map((rule) => [rule, 'off'])),
  })),
];
