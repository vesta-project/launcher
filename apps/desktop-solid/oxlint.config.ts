import { defineConfig } from 'oxlint';
import solidV2 from 'eslint-plugin-solid/configs/v2';

export default defineConfig({
  jsPlugins: ['eslint-plugin-solid'],
  ignorePatterns: ['**/*.gen.*', 'dist'],
  settings: solidV2.settings,
  rules: solidV2.rules,
  overrides: [
    {
      // The UI library stays independent: no launcher source, native APIs or workbench.
      files: ['ui/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              { group: ['@tauri-apps/*'], message: 'ui/ must not depend on native APIs.' },
              { group: ['**/src/**', '~/*'], message: 'ui/ must not import launcher code.' },
              { group: ['**/workbench/**'], message: 'Only *.stories.tsx may import the workbench.' },
            ],
          },
        ],
      },
    },
    {
      files: ['ui/**/*.stories.tsx'],
      rules: { 'no-restricted-imports': 'off' },
    },
  ],
});
