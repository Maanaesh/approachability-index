import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { migrate } from '../../src/db/migrate.js';

pg.types.setTypeParser(1082, (v) => v); // keep DATE as 'YYYY-MM-DD'

export const testKey = Buffer.alloc(32, 9);

// Each test file gets its own schema so files never see each other's rows.
export async function testDb(): Promise<{ pool: pg.Pool; close: () => Promise<void> }> {
  const schema = `t_${randomBytes(6).toString('hex')}`;
  const url = process.env.TEST_DATABASE_URL!;
  const admin = new pg.Pool({ connectionString: url });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` });
  await migrate(pool);
  return {
    pool,
    close: async () => {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
}
