import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['cjs'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  bundle: true,
  minify: false,
  // argon2 has native bindings — must stay external so Node loads the .node file at runtime
  external: ['argon2'],
  // Do NOT externalize the generated prisma client — bundle it in
  noExternal: [/generated\/prisma/],
});
