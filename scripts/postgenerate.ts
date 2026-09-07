/**
 * postgenerate.ts — runs after `prisma generate` to create the index.ts barrel.
 * Prisma 6 generates client.ts + enums.ts but no index.ts for directory-style imports.
 * This script creates one so `import { X } from '../../generated/prisma'` resolves.
 */
import { writeFileSync } from 'fs';
import { join } from 'path';

const outputPath = join(__dirname, '../src/generated/prisma/index.ts');

const content = `// Auto-generated barrel — do not edit manually.
// Recreated by scripts/postgenerate.ts after every prisma generate.
// client.ts already re-exports enums, so we only need to export client.
export * from './client';
`;

writeFileSync(outputPath, content, 'utf-8');
console.log('✅ Created src/generated/prisma/index.ts');
