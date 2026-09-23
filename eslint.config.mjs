import js from '@eslint/js';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { createNodeResolver } from 'eslint-plugin-import-x';
import fs from 'node:fs';
import path from 'node:path';
import tsParser from '@typescript-eslint/parser';
import eslintConfigPrettier from 'eslint-config-prettier';
import eslintPluginBetterTailwindcss from 'eslint-plugin-better-tailwindcss';
import importx from 'eslint-plugin-import-x';
import pinia from 'eslint-plugin-pinia';
import vue from 'eslint-plugin-vue';
import { globalIgnores } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import vueParser from 'vue-eslint-parser';

// @sillytavern/* imports resolve to <ST>/public/* at runtime (the extension
// host serves them). For out-of-tree linting, point SILLYTAVERN_DIR at a
// SillyTavern clone: SILLYTAVERN_DIR=~/Projects/SillyTavern pnpm lint
const ST_PUBLIC = process.env.SILLYTAVERN_DIR ? path.join(process.env.SILLYTAVERN_DIR, 'public') : null;

/** @type {import('@typescript-eslint/utils').TSESLint.FlatConfig.ConfigFile} */
export default [
  {
    // env-gated so plain `pnpm lint` keeps working without a ST checkout
    settings: {
      'import-x/resolver-next': [
        {
          interfaceVersion: 3,
          name: 'sillytavern',
          resolve(source) {
            if (!ST_PUBLIC || !source.startsWith('@sillytavern/')) return { found: false };
            const base = path.join(ST_PUBLIC, source.slice('@sillytavern/'.length));
            for (const candidate of [base + '.js', base + '.ts', base + '/index.js', base + '/index.ts']) {
              if (fs.existsSync(candidate)) return { found: true, path: candidate };
            }
            return { found: false };
          },
        },
        createTypeScriptImportResolver(),
        createNodeResolver(),
      ],
    },
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  importx.flatConfigs.recommended,
  importx.flatConfigs.typescript,
  ...vue.configs['flat/recommended'],
  pinia.configs['recommended-flat'],
  {
    plugins: {
      'better-tailwindcss': eslintPluginBetterTailwindcss,
    },
    rules: {
      ...eslintPluginBetterTailwindcss.configs['recommended-warn'].rules,
      ...eslintPluginBetterTailwindcss.configs['recommended-error'].rules,
      'better-tailwindcss/enforce-consistent-line-wrapping': ['warn', { preferSingleLine: true, printWidth: 120 }],
      'better-tailwindcss/no-unknown-classes': [
        'warn',
        {
          ignore: [
            'TH-*',
            'extension_container',
            'extensionsMenuExtensionButton',
            'fa-*',
            'flex-container',
            'flexGap5',
            'inline-drawer-*',
            'interactable',
            'list-*',
            'menu_button*',
            'popup',
            'qr--button',
            'qr--buttons',
            'text_pole',
            'note-link-span',
          ],
        },
      ],
    },
    settings: {
      'better-tailwindcss': {
        entryPoint: 'src/global.css',
        tailwindConfig: 'tailwind.config.js',
      },
    },
  },
  {
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tsParser,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      'handle-callback-err': 'off',
      'import-x/no-console': 'off',
      'import-x/no-cycle': 'error',
      'import-x/no-dynamic-require': 'warn',
      'import-x/no-nodejs-modules': 'warn',
      'no-dupe-class-members': 'off',
      'no-empty-function': 'off',
      'no-floating-decimal': 'error',
      'no-lonely-if': 'error',
      'no-multi-spaces': 'error',
      'no-redeclare': 'off',
      'no-shadow': 'off',
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-var': 'error',
      'pinia/require-setup-store-properties-export': 'off',
      'prefer-const': 'warn',
      'vue/multi-word-component-names': 'off',
      yoda: 'error',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  eslintConfigPrettier,
  globalIgnores(['dist/**', 'node_modules/**', 'eslint.config.mjs', 'postcss.config.js', 'vite.config.ts']),
];
