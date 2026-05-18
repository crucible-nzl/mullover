import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Production env file is /etc/counsel-day-app/env.local.');
}

// One pool per process. Postgres-js default pool size is 10 · fine for CAX11.
const client = postgres(process.env.DATABASE_URL, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 5,
  prepare: false, // safer with pg-bouncer if/when it lands; cheap to disable here
});

export const db = drizzle(client, { schema });
export { schema };
