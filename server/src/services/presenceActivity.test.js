const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { PGlite } = require('@electric-sql/pglite')
const { quarterRange, recordActivity } = require('./presenceActivity')
const USER = '00000000-0000-4000-8000-000000000001'
let db

test.before(async () => {
  db = new PGlite()
  await db.exec(`create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated; create role service_role bypassrls; insert into auth.users values ('${USER}');`)
  await db.exec(`create table public.company_holidays (holiday_date date not null, holiday_type text not null, is_active boolean not null default true); grant select on public.company_holidays to service_role;`)
  await db.exec(await fs.readFile(path.join(__dirname, '../../../supabase/migrations/20261120222043_user_daily_activity.sql'), 'utf8'))
})
test.after(async () => { await db?.close() })

const record = intervals => db.query('select public.record_user_activity($1::uuid, $2::jsonb)', [USER, JSON.stringify(intervals)])
const interval = (start, end) => ({ start: new Date(start).toISOString(), end: new Date(end).toISOString() })
const summary = async (start, end) => (await db.query('select * from public.user_activity_summary($1::uuid[], $2::date, $3::date)', [[USER], start, end])).rows[0]

test('fiscal quarters validate inputs and handle Q4 in the following calendar year', () => {
  assert.deepEqual(quarterRange('FY 2026-27 Q4'), { period: 'FY 2026-27 Q4', start: '2027-01-01', end: '2027-03-31' })
  assert.equal(quarterRange(undefined, new Date('2026-11-21T00:00:00Z')).period, 'FY 2026-27 Q3')
  assert.throws(() => quarterRange('FY 2026-28 Q3'), /Invalid/)
})

test('overlapping devices and duplicate/retried intervals count their union only', async () => {
  const now = Date.now() - 1000
  await record([interval(now - 60000, now - 20000), interval(now - 40000, now)])
  await record([interval(now - 60000, now)])
  const row = (await db.query('select active_seconds from public.user_daily_activity where user_id=$1', [USER])).rows[0]
  assert.equal(row.active_seconds, 60)
})

test('server bounds reject offline gaps and future credit', async () => {
  await db.exec('truncate public.user_daily_activity')
  await record([interval(Date.now() - 24 * 3600000, Date.now() + 3600000)])
  const row = (await db.query('select sum(active_seconds) as seconds from public.user_daily_activity')).rows[0]
  assert.equal(Number(row.seconds), 120)
})

test('average includes missing/absent Mon-Sat days and excludes Sunday time', async () => {
  await db.exec('truncate public.user_daily_activity')
  // April 1-7 2026: six Mon-Sat days; Sunday April 5 is excluded.
  await db.query(`insert into public.user_daily_activity(user_id,activity_date,active_periods) values
    ($1,'2026-04-01',tstzmultirange(tstzrange('2026-04-01T04:00Z','2026-04-01T05:00Z','[)'))),
    ($1,'2026-04-03',tstzmultirange(tstzrange('2026-04-03T04:00Z','2026-04-03T04:30Z','[)'))),
    ($1,'2026-04-05',tstzmultirange(tstzrange('2026-04-05T04:00Z','2026-04-05T12:00Z','[)')))
  `, [USER])
  const row = await summary('2026-04-01', '2026-04-07')
  assert.equal(row.average_days, 6)
  assert.equal(row.average_seconds, 5400 / 6)
  // Four unrecorded weekdays remain in the divisor. No attendance filter exists.
  const future = await summary('2099-04-01', '2099-06-30')
  assert.equal(future.average_days, 0)
  assert.equal(future.average_seconds, 0)
})

test('active calendar holidays of every type are excluded from both total and divisor for their exact year', async () => {
  await db.exec('truncate public.user_daily_activity, public.company_holidays')
  try {
    await db.query(`insert into public.user_daily_activity(user_id,activity_date,active_periods) values
      ($1,'2026-04-01',tstzmultirange(tstzrange('2026-04-01T04:00Z','2026-04-01T05:00Z','[)'))),
      ($1,'2026-04-03',tstzmultirange(tstzrange('2026-04-03T04:00Z','2026-04-03T04:30Z','[)'))),
      ($1,'2026-04-05',tstzmultirange(tstzrange('2026-04-05T04:00Z','2026-04-05T12:00Z','[)')))
    `, [USER])
    await db.exec(`insert into public.company_holidays(holiday_date,holiday_type,is_active) values
      ('2026-04-01','national',true), ('2026-04-02','company',true),
      ('2026-04-04','optional',true), ('2026-04-05','national',true),
      ('2026-04-06','company',false), ('2025-04-07','national',true),
      ('2027-04-07','national',true), ('2026-07-01','national',true)`)
    const row = await summary('2026-04-01','2026-04-07')
    assert.equal(row.average_days, 3)
    assert.equal(row.average_seconds, 1800 / 3)
    // Removing a calendar holiday restores its recorded time and its date.
    await db.exec("update public.company_holidays set is_active=false where holiday_date='2026-04-01'")
    const revised = await summary('2026-04-01','2026-04-07')
    assert.equal(revised.average_days, 4)
    assert.equal(revised.average_seconds, 5400 / 4)
  } finally { await db.exec('truncate public.company_holidays') }
})

test('a period with only holidays and Sundays has a zero average without division errors', async () => {
  await db.exec('truncate public.user_daily_activity, public.company_holidays')
  try {
    await db.exec(`insert into public.company_holidays(holiday_date,holiday_type)
      select d::date,'national' from generate_series('2026-04-01'::date,'2026-04-07'::date,interval '1 day') d`)
    const row = await summary('2026-04-01','2026-04-07')
    assert.equal(row.average_days, 0)
    assert.equal(row.average_seconds, 0)
  } finally { await db.exec('truncate public.company_holidays') }
})

test('Today retains recorded time on a holiday while Average excludes that date', async () => {
  await db.exec('truncate public.user_daily_activity, public.company_holidays')
  try {
    await db.exec(`insert into public.company_holidays(holiday_date,holiday_type)
      values ((now() at time zone 'Asia/Kolkata')::date,'national')`)
    await db.query(`insert into public.user_daily_activity(user_id,activity_date,active_periods)
      values ($1,(now() at time zone 'Asia/Kolkata')::date,tstzmultirange(tstzrange(now()-interval '10 minutes',now()-interval '5 minutes','[)')))`, [USER])
    const row = (await db.query(`select * from public.user_activity_summary($1::uuid[],
      (now() at time zone 'Asia/Kolkata')::date,(now() at time zone 'Asia/Kolkata')::date)`, [[USER]])).rows[0]
    assert.equal(row.today_seconds, 300)
    assert.equal(row.average_days, 0)
    assert.equal(row.average_seconds, 0)
  } finally { await db.exec('truncate public.company_holidays') }
})

test('IST midnight splits a range into separate days; today resets without deleting history', async () => {
  await db.exec('truncate public.user_daily_activity')
  // Freeze only the recorder's clock to exercise its real midnight split loop.
  const original = (await db.query("select pg_get_functiondef('public.record_user_activity(uuid,jsonb)'::regprocedure) as sql")).rows[0].sql
  await db.exec(original.replace('clock_timestamp()', "'2026-04-01T18:30:30Z'::timestamptz"))
  try { await record([{ start: '2026-04-01T18:29:30Z', end: '2026-04-01T18:30:30Z' }]) }
  finally { await db.exec(original) }
  assert.deepEqual((await db.query('select activity_date::text as day,active_seconds from public.user_daily_activity order by activity_date')).rows,
    [{ day: '2026-04-01', active_seconds: 30 }, { day: '2026-04-02', active_seconds: 30 }])
  assert.equal((await summary('2026-04-01','2026-06-30')).today_seconds, 0)
})

test('daily history and RPCs are inaccessible to anon/authenticated clients', async () => {
  const result = await db.query(`select relrowsecurity from pg_class where oid='public.user_daily_activity'::regclass`)
  assert.equal(result.rows[0].relrowsecurity, true)
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`)
    await assert.rejects(db.query('select * from public.user_daily_activity'), /permission denied/)
    await assert.rejects(record([]), /permission denied/)
    await assert.rejects(summary('2026-04-01', '2026-06-30'), /permission denied/)
    await db.exec('reset role')
  }
})

test('API validates intervals and takes user identity from the authenticated caller', async () => {
  let args
  await recordActivity({ rpc: async (name, payload) => { args = { name, payload }; return {} } }, USER, [interval(0, 1000)])
  assert.equal(args.payload.p_user_id, USER)
  await assert.rejects(recordActivity({}, USER, [{ start: 'bad', end: 'bad' }]), /Invalid/)
  await assert.rejects(recordActivity({}, USER, Array(501).fill(interval(0, 1000))), /Invalid/)
})
