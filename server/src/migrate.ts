// Standalone migration entry: `bun run migrate`. Applies schema.sql and exits.

import { migrate } from './db';

await migrate();
console.log('migrations applied');
process.exit(0);
