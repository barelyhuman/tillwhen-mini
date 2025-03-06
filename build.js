//  build.js
import { soul } from './soul.js'

await soul({
  entries: ['./src/server.ts'],
  assets: [
    {
      src: './src/views',
      pattern: '**/*',
      dist: './dist/views',
    },
    {
      src: './src/public',
      pattern: '**/*',
      dist: './dist/public',
      process: true,
      bundle: true,
      format: 'esm',
      minify: true,
    },
  ],
})
