const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createDatabase, CONSULTANT, OTHER } = require('../../test-support/assignedCandidatesSchema.cjs')

test('CRM read receipts preserve viewer isolation, sentiment, pagination snapshots and access controls', async t => {
  const db = await createDatabase(); t.after(() => db.close())
  for (const name of ['20261019105523_business_development_crm.sql', '20261019165228_crm_gmail_integration.sql', '20261019185136_crm_activity_read_receipts.sql', '20261021093133_crm_incoming_email_row_highlights.sql']) {
    await db.exec(await fs.readFile(path.resolve(__dirname, '../../../supabase/migrations', name), 'utf8'))
  }
  const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0]
  const save = async name => scalar('select crm_save($1,null,null,$2)', [CONSULTANT, JSON.stringify({ organisation_name: name, contacts: [{ name: 'HR', mobile: '9876543210', email: 'hr@example.test' }] })])
  const client = await save('Unread Client'), other = await save('Other Client')
  const unread = (user = CONSULTANT) => scalar('select crm_unread_activity($1,$2)', [user, [client.id, other.id]])
  const mark = (ids, user = CONSULTANT, clientId = client.id) => scalar('select crm_mark_activity_read($1,$2,$3)', [user, clientId, ids])
  let sequence = 0
  const email = (label, direction = 'incoming') => scalar("insert into crm_activities(crm_client_id,activity_type,created_by,gmail_user_id,gmail_message_id,email_metadata,created_at) values($1,'gmail_email',$2,$2,$3,$4,now()+($5 * interval '1 second')) returning id", [client.id, CONSULTANT, `message-${++sequence}`, JSON.stringify({ direction, sentiment: { label } }), sequence])
  const summaryChanged = () => scalar("insert into crm_activities(crm_client_id,activity_type,created_by,created_at) values($1,'organisation_summary_changed',$2,now()+($3 * interval '1 second')) returning id", [client.id, CONSULTANT, ++sequence])

  await t.test('only incoming emails determine tint; summaries and outgoing emails preserve it', async () => {
    assert.equal((await unread())[client.id].unread_tone, null)
    await summaryChanged()
    await email('negative', 'outgoing')
    assert.equal((await unread())[client.id].unread_tone, null)
    for (const [label, expected] of [['negative', 'negative'], ['positive', 'positive'], ['neutral', 'neutral'], ['unknown', 'neutral']]) {
      await email(label)
      assert.equal((await unread())[client.id].unread_tone, expected)
      if (label === 'negative') {
        await email('positive', 'outgoing')
        await summaryChanged()
        assert.equal((await unread())[client.id].unread_tone, 'negative')
      }
    }
    assert.equal((await unread())[client.id].unread_activity_count, 9)
    assert.deepEqual(await scalar('select crm_unread_activity($1,$2)', [CONSULTANT, []]), {})
  })
  await t.test('only displayed activity IDs are acknowledged; new arrivals remain unread; retries are idempotent', async () => {
    const viewed = (await db.query('select id from crm_activities where crm_client_id=$1', [client.id])).rows.map(row => row.id)
    const arrivedAfterLoad = await email('negative')
    assert.equal(await mark(viewed), viewed.length)
    assert.equal(await mark(viewed), 0)
    assert.deepEqual((await unread())[client.id], { unread_activity_count: 1, unread_tone: 'negative' })
    assert.equal((await unread(OTHER))[client.id].unread_activity_count, viewed.length + 1)
    const otherId = await scalar('select id from crm_activities where crm_client_id=$1 limit 1', [other.id])
    assert.equal(await mark([otherId]), 0)
    assert.equal((await unread())[other.id].unread_activity_count, 1)
    await mark([arrivedAfterLoad])
    assert.equal((await unread())[client.id], undefined)
    await summaryChanged()
    await email('negative', 'outgoing')
    assert.equal((await unread())[client.id].unread_tone, null)
  })
  await t.test('Read all covers every client for this viewer and leaves subsequent activity unread', async () => {
    await mark(null, CONSULTANT, null)
    assert.deepEqual(await unread(), {})
    assert.ok(Object.keys(await unread(OTHER)).length)
    await email('positive')
    assert.equal((await unread())[client.id].unread_activity_count, 1)
    for (const args of [[null, null, null], [CONSULTANT, client.id, null], [CONSULTANT, null, []], [CONSULTANT, client.id, []]]) {
      await assert.rejects(db.query('select crm_mark_activity_read($1,$2,$3)', args), /Invalid CRM read request/)
    }
  })
  await t.test('RLS and restricted grants block browser roles; service-only invoker functions work', async () => {
    assert.equal(await scalar("select relrowsecurity from pg_class where oid='public.crm_activity_reads'::regclass"), true)
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`)
      await assert.rejects(db.query('select * from crm_activity_reads'), /permission denied/)
      await assert.rejects(unread(), /permission denied/)
      await assert.rejects(mark(null, CONSULTANT, null), /permission denied/)
      await db.exec('reset role')
    }
    await db.exec('set role service_role')
    await mark(null, CONSULTANT, null)
    assert.deepEqual(await unread(), {})
    await assert.rejects(db.query('delete from crm_activity_reads'), /permission denied/)
    await db.exec('reset role')
    assert.equal(await scalar("select bool_or(prosecdef) from pg_proc where proname in ('crm_unread_activity','crm_mark_activity_read')"), false)
  })
})
