// Server entry: apply migrations, then listen. Bun.serve consumes Hono's fetch
// handler directly.

import app from './app';
import { migrate } from './db';
import { config } from './config';

await migrate();

const server = Bun.serve({
  port: config.port,
  fetch: app.fetch,
});

console.log(`pandemonium-api listening on ${server.url}`);
