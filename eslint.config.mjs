import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

const config = [
  {
    ignores: ['.next/**', 'node_modules/**', 'scratch/**', 'next-env.d.ts', 'tsconfig.tsbuildinfo'],
  },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      /**
       * Every image in this product is a URL the workspace owner typed or picked
       * from their own storage bucket, on a host we do not control. next/image
       * would rewrite it through a loader we have not configured, which breaks
       * the owner's image on a live site — so the published renderer, the media
       * library and the canvas all use a plain <img> on purpose.
       */
      '@next/next/no-img-element': 'off',
    },
  },
];

export default config;
