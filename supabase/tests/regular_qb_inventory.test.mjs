import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
test('2026 inventory is SELECT-only and works before/after additive snapshot columns',{skip:!process.env.PGLITE_MODULE},async()=>{
 const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href),db=new PGlite();
 const query=await readFile(new URL('../audits/regular_qb_history_2026.sql',import.meta.url),'utf8');
 try{
  await db.exec(`create table users(id uuid,display_name text,real_name text);
   create table qb_picks(id uuid,user_id uuid,qb_id uuid,season int,week int,created_at timestamptz);
   create table qbs(id uuid,name text,espn_athlete_id text,team text,active boolean,is_active_starter boolean);
   create table qb_ratings(id uuid,qb_id uuid,season int,week int,actual_qb_name text,actual_espn_athlete_id text,passer_rating numeric,created_at timestamptz);
   create table weekly_scores(season int,week int,user_id uuid,base_points int,multiplier numeric,final_score numeric);
   create table regular_final_publications(season int,published_at timestamptz,source jsonb);
   insert into qbs values('00000000-0000-0000-0000-000000000001','Tanner McKee','2','Eagles',true,true);
   insert into users values('00000000-0000-0000-0000-000000000002','Player','Real name');
   insert into qb_picks select ('00000000-0000-0000-0000-00000000000'||w)::uuid,'00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001',2026,w,now() from generate_series(2,4) w;
   insert into qb_ratings select id,qb_id,2026,week,case when week=3 then 'Tanner McKee' else 'Jalen Hurts' end,case when week=3 then '2' else '1' end,85.9,now() from qb_picks;`);
  const read=async()=>{await db.exec('begin read only');try{return (await db.query(query)).rows;}finally{await db.exec('rollback');}};
  const before=await read();assert.equal(before.length,3);assert.ok(before.every(r=>r.classification==='AMBIGU'));assert.equal(before[0].catalog_name_now,'Tanner McKee');assert.equal(before[0].actual_qb_name,'Jalen Hurts');assert.equal(Number(before[0].passer_rating),85.9);
  await db.exec(`alter table qb_picks add selected_qb_name text,add selected_espn_athlete_id text,add selected_team text;
   update qb_picks set selected_qb_name='Jalen Hurts',selected_espn_athlete_id='1',selected_team='Eagles' where week in(2,3);`);
  const after=await read();assert.deepEqual(after.map(r=>r.classification),['CERTAIN — NORMAL','CERTAIN — REMPLACEMENT','AMBIGU']);assert.equal(Number(after[0].passer_rating),85.9);
 }finally{await db.close();}
});
