const { PGlite } = require('@electric-sql/pglite')
const fs = require('node:fs/promises')
const path = require('node:path')
const USER = '00000000-0000-4000-8000-000000000001'

async function presenceDatabase() {
  const sql = new PGlite()
  await sql.exec(`create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated; create role service_role bypassrls; insert into auth.users values ('${USER}');`)
  await sql.exec(`create table public.company_holidays (holiday_date date not null, holiday_type text not null, is_active boolean not null default true); grant select on public.company_holidays to service_role;`)
  await sql.exec(await fs.readFile(path.resolve(__dirname, '../../supabase/migrations/20261120222043_user_daily_activity.sql'), 'utf8'))
  await sql.exec(await fs.readFile(path.resolve(__dirname, '../../supabase/migrations/20261120223343_presence_average_tracking_start.sql'), 'utf8'))
  await sql.exec(await fs.readFile(path.resolve(__dirname, '../../supabase/migrations/20261124200225_activity_backlog_recovery.sql'), 'utf8'))
  const tables = { user_presence: [], employee_statuses: [] }
  return {
    sql, tables,
    async rpc(name, args) {
      try {
        if (['record_user_activity', 'record_user_activity_backlog'].includes(name)) {
          await sql.query(`select public.${name}($1::uuid,$2::jsonb)`, [args.p_user_id, JSON.stringify(args.p_intervals)])
          return { data: null, error: null }
        }
        const result = await sql.query('select * from public.user_activity_summary($1::uuid[],$2::date,$3::date)', [args.p_user_ids, args.p_start, args.p_end])
        return { data: result.rows.map(row => ({ ...row, activity_date: new Date(row.activity_date).toISOString().slice(0, 10) })), error: null }
      } catch (error) { return { data: null, error } }
    },
    from(table) {
      const filters = []
      let operation = 'select', payload
      const q = {
        select() { return q }, order() { return q },
        eq(key, value) { filters.push(row => row[key] === value); return q },
        in(key, values) { filters.push(row => values.includes(row[key])); return q },
        gte(key, value) { filters.push(row => row[key] >= value); return q },
        upsert(value) { operation = 'upsert'; payload = value; return q },
        delete() { operation = 'delete'; return q },
        then(resolve, reject) {
          try {
            const rows = tables[table]
            if (!rows) throw new Error(`Unexpected table: ${table}`)
            if (operation === 'upsert') {
              const existing = rows.find(row => row.user_id === payload.user_id && row.tab_id === payload.tab_id)
              if (existing) Object.assign(existing, payload)
              else rows.push({ ...payload })
            }
            const data = rows.filter(row => filters.every(filter => filter(row)))
            if (operation === 'delete') tables[table] = rows.filter(row => !data.includes(row))
            return Promise.resolve({ data, error: null }).then(resolve, reject)
          } catch (error) { return Promise.resolve({ data: null, error }).then(resolve, reject) }
        }
      }
      return q
    }
  }
}
module.exports = { presenceDatabase, USER }
