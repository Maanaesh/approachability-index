import pg from 'pg';

pg.types.setTypeParser(1082, (v) => v); // DATE stays 'YYYY-MM-DD'

export type Queryable = pg.Pool | pg.PoolClient;

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl });
}
