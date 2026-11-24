import { spawn } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { access, appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

export const admin = '00000000-0000-0000-0000-000000000001';
export const member = '00000000-0000-0000-0000-000000000002';
export const other = '00000000-0000-0000-0000-000000000003';
export const quoteSql = value => "'" + String(value).replaceAll("'", "''") + "'";

export function signedExchange(secret, action, report, {
  timestamp = new Date().toISOString(), nonce = randomUUID(), valid = true,
} = {}) {
  const p_message = JSON.stringify({ action, timestamp, nonce, report });
  const p_signature = createHmac('sha256', secret).update(valid ? p_message : 'invalid').digest('hex');
  return { p_message, p_signature };
}

export function exchangeSql({ p_message, p_signature }) {
  return `set role anon; select public.qb_observer_exchange(${quoteSql(p_message)},${quoteSql(p_signature)});`;
}

const migrations = [
  '202609240001_playoff_seeds.sql',
  '202609250001_playoff_round_admin.sql',
  '202609290001_playoff_scoring.sql',
  '202609300001_notification_reminders.sql',
  '202610040001_lifecycle_foundation.sql',
  '202610050001_regular_final_publication.sql',
  '202610070001_lifecycle_transition.sql',
  '202610080001_playoff_atomic_advance.sql',
  '202610090001_lifecycle_completion.sql',
  '202610190001_regular_qb_selection_snapshot.sql',
  '20261025164727_regular_ties_admin_robustness.sql',
  '20261105132645_qb_observation_log.sql',
  '202611060001_regular_weekly_qb_menu.sql',
  '20261121183802_qb_free_source_observation.sql',
];

function startProcess(binary, args, env, input = '', timeout = 20_000) {
  const child = spawn(binary, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const done = new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.stdout.setEncoding('utf8').on('data', bytes => { stdout += bytes; });
    child.stderr.setEncoding('utf8').on('data', bytes => { stderr += bytes; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `Process stopped (${signal ?? code}): ${binary}`));
    });
    child.stdin.on('error', () => {}); // Errors are reported on close.
    child.stdin.end(input);
  });
  return { child, done };
}

// The DSN and authentication environment are deliberately constructed here.
// No test can fall back to a project URL or a pre-existing PostgreSQL instance.
export async function withNativeQbFixture(task) {
  const bin = process.env.QB_TEST_PG_BIN;
  if (!bin || !isAbsolute(bin)) throw new Error('Set QB_TEST_PG_BIN to an absolute PostgreSQL bin directory');
  for (const name of ['initdb', 'pg_ctl', 'psql']) await access(join(bin, name));
  const socket = await mkdtemp('/tmp/qb-native-');
  const data = join(socket, 'data');
  const env = {
    PATH: `${bin}:/usr/bin:/bin`, LC_ALL: 'C', TZ: 'UTC',
    PGHOST: socket, PGPORT: '5432', PGUSER: 'postgres', PGDATABASE: 'postgres', PGCONNECT_TIMEOUT: '5',
  };
  const run = (name, args, input, timeout) => startProcess(join(bin, name), args, env, input, timeout);
  const startSql = text => run('psql', [
    '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', socket, '-p', '5432', '-U', 'postgres', '-d', 'postgres',
  ], `set request.headers = '{"x-pool-regular-schema":"20261009"}';\n${text}\n`);
  const sql = text => startSql(text).done;
  const asRole = (actor, text) => sql(
    `set request.jwt.claim.sub = ${quoteSql(actor)}; set role authenticated;\n${text}`
  );
  const scalar = sql;
  const secret = randomBytes(32).toString('hex');
  let started = false;
  const criticalState = async () => JSON.parse(await sql(`select jsonb_build_object(
    'picks', (select jsonb_agg(to_jsonb(t) order by id) from public.picks t),
    'qb_picks', (select jsonb_agg(to_jsonb(t) order by id) from public.qb_picks t),
    'ratings', (select jsonb_agg(to_jsonb(t) order by id) from public.qb_ratings t),
    'scores', (select jsonb_agg(to_jsonb(t) order by id) from public.weekly_scores t),
    'catalog', (select jsonb_agg(to_jsonb(t) order by id) from public.qbs t),
    'settings', (select jsonb_agg(to_jsonb(t) order by id) from public.settings t),
    'offers', (select jsonb_agg(to_jsonb(t) order by season, week, team_id) from qb_observation.regular_menu_overrides t),
    'reservations', (select jsonb_agg(to_jsonb(t) order by season, week, team_id) from qb_observation.regular_menu_reservations t)
  );`));
  try {
    await run('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'], '', 40_000).done;
    await appendFile(join(data, 'postgresql.conf'), `
listen_addresses = ''
unix_socket_directories = '${socket}'
fsync = off
statement_timeout = '12s'
`);
    const log = join(socket, 'postgres.log');
    try { await run('pg_ctl', ['-D', data, '-l', log, '-w', '-t', '10', 'start']).done; }
    catch (error) {
      const logText = await readFile(log, 'utf8').catch(() => '');
      throw new Error(`${error.message}\n${logText}`);
    }
    started = true;
    for (const file of ['lifecycle_fixture.sql', 'lifecycle_transition_fixture.sql']) {
      await sql(await readFile(new URL(file, import.meta.url), 'utf8'));
    }
    await sql(`create role authenticator noinherit;
      update settings set current_season=2026 where id=1;
      insert into users(id,is_admin) values ('${admin}',true),('${member}',false),('${other}',false);
      insert into teams(name,espn_abbr) values ('Washington Commanders','WAS'),('Buffalo Bills','BUF');
      insert into qbs(name,team,espn_athlete_id,active,is_active_starter) values
        ('Current QB','Commanders','99',true,true),('Backup QB','Commanders','100',true,false),
        ('Bills QB','Bills','123',true,true);`);
    for (const file of migrations) {
      const migration = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
      if (file === '202610090001_lifecycle_completion.sql') {
        await sql(migration.slice(0, migration.indexOf('-- END REGULAR WRITE PAUSE BOOTSTRAP')) + 'commit;');
        await sql('update settings set regular_writes_paused=true where id=1;');
      }
      await sql(migration);
    }
    // The settings guard checks the old pause state for changes to the week.
    await sql('update settings set regular_writes_paused=false where id=1;');
    await sql(`update settings set current_week=5 where id=1;
      insert into season_participants(season,user_id,confirmed) values
        (2026,'${member}',true),(2026,'${other}',true);
      insert into qb_selection_weeks(season,week,started_at) values(2026,5,now()-interval '1 hour');
      insert into games(external_game_id,season,week,home_team,away_team,game_date,is_pool_eligible)
        values('5005',2026,5,'Washington Commanders','Buffalo Bills',now()+interval '1 day',false);
      create schema extensions;
      create extension pgcrypto with schema extensions;
      update qb_observation.transport_control set dispatch_enabled=true,hmac_secret=${quoteSql(secret)} where singleton;`);
    return await task({ sql, scalar, startSql, asRole, criticalState, secret, socket, env });
  } finally {
    if (started) await run('pg_ctl', ['-D', data, '-w', '-t', '10', '-m', 'immediate', 'stop']).done;
    await rm(socket, { recursive: true, force: true });
  }
}
