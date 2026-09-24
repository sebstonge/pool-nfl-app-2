// Run with PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js.
// Installs no production dependency and never connects to a remote database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

test('migration, RPCs and role protections in isolated PostgreSQL', { skip: !process.env.PGLITE_MODULE }, async t => {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await db.exec(await readFile(new URL('../migrations/202609240001_playoff_seeds.sql', import.meta.url), 'utf8'));
    const rows = ['AFC','NFC'].flatMap((conference,c)=>Array.from({length:7},(_,i)=>({season:2026,team:`${conference}${i+1}`,espn_team_id:String(c*16+i+1),conference,seed:i+1})));
    const sync = rows => db.query('select public.sync_playoff_seeds($1,$2::jsonb)::text as captured',[2026,JSON.stringify(rows)]);
    let captured;
    await t.test('service RPC creates and replaces complete drafts; swaps do not violate uniqueness',async()=>{
      await db.exec('set role service_role');
      await sync(rows);
      const swapped=structuredClone(rows);[swapped[0].seed,swapped[1].seed]=[swapped[1].seed,swapped[0].seed];
      await sync(swapped);
      captured=(await sync(rows)).rows[0].captured;
      assert.equal((await db.query('select count(*)::int as n from public.playoff_seeds')).rows[0].n,14);
    });
    await t.test('invalid sync preserves previous snapshot atomically',async()=>{
      await assert.rejects(sync(rows.slice(1)),/14/);
      const duplicate=structuredClone(rows);duplicate[1].team=duplicate[0].team;
      await assert.rejects(sync(duplicate),/Duplicate/);
      assert.equal((await db.query('select count(*)::int as n from public.playoff_seeds')).rows[0].n,14);
    });
    await t.test('authenticated read permitted; direct writes and RPCs forbidden; anon read forbidden',async()=>{
      await db.exec('reset role; set role authenticated');
      assert.equal((await db.query('select count(*)::int as n from public.playoff_seeds')).rows[0].n,14);
      await assert.rejects(db.exec('delete from public.playoff_seeds'),/permission denied/);
      await assert.rejects(sync(rows),/permission denied/);
      await assert.rejects(db.query('select public.finalize_playoff_seeds($1,$2)',[2026,captured]),/permission denied/);
      await db.exec('reset role; set role anon');
      await assert.rejects(db.exec('select * from public.playoff_seeds'),/permission denied/);
      await db.exec('reset role; set role service_role');
    });
    await t.test('stale capture and incomplete season cannot finalize',async()=>{
      await assert.rejects(db.query('select public.finalize_playoff_seeds($1,$2)',[2026,'2000-01-01']),/changed/);
      await assert.rejects(db.query('select public.finalize_playoff_seeds($1,$2)',[2027,captured]),/Incomplete/);
    });
    await t.test('finalized snapshot rejects synchronization, deletion, update and additional rows',async()=>{
      await db.query('select public.finalize_playoff_seeds($1,$2)',[2026,captured]);
      assert.equal((await db.query('select count(finalized_at)::int as n from public.playoff_seeds')).rows[0].n,14);
      await assert.rejects(sync(rows),/Finalized/);
      await assert.rejects(db.exec('update public.playoff_seeds set seed=2'),/permission denied/);
      await db.exec('reset role');
      await assert.rejects(db.exec("update public.playoff_seeds set finalized_at=null where seed=1"),/immutable/);
      await assert.rejects(db.exec('delete from public.playoff_seeds'),/immutable/);
      await assert.rejects(db.exec("insert into public.playoff_seeds(season,team,espn_team_id,conference,seed,captured_at) values(2026,'NEW','99','AFC',1,now())"),/immutable/);
    });
    await t.test('even privileged partial finalization rolls back at transaction end',async()=>{
      await db.exec("insert into public.playoff_seeds(season,team,espn_team_id,conference,seed,captured_at) values(2027,'A','1','AFC',1,now())");
      await assert.rejects(db.exec('update public.playoff_seeds set finalized_at=now() where season=2027'),/exactly seven/);
      assert.equal((await db.query('select finalized_at from public.playoff_seeds where season=2027')).rows[0].finalized_at,null);
    });
  } finally { await db.close(); }
});
