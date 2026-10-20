# Candidates, Clients and Mandates search

Source review and local changes: 20 October 2026. Runtime validation is intentionally pending the user's manual testing. No tests, lint, builds, browser checks, AI calls or database queries were run for this change.

## How search works

All three boxes already used a single primary-provider AI request. The browser submits a sentence to the table's `ai-filter` endpoint, the server gives the model only permission-approved field metadata and the sentence, and validates its response into a structured filter tree, text search, or both. Existing server query planners resolve names/IDs and apply the filters before pagination. A failed interpretation previously fell through to the local rule parser, then keyword matching without an explanation in the UI.

The important problems found in source:

- `aiProvider` silently truncated prompt text at 12,000 characters. The sentence came last, after instructions and a lengthy field registry, so long prompts could lose fields or the request itself.
- Candidate keyword search combined every term with OR: a multiword request could match any one word. It also sliced off later terms. Clients and Mandates required each retained term but still sliced off later terms according to the field count.
- Errors, low confidence, unsupported conditions and quota failures could all become keyword searches. Negations, bounds and other structured constraints could consequently lose their meaning.
- A Mandates/Clients fallback could apply only a recognized sort while failing to understand the actual requested conditions.
- The command-word guard rejected otherwise read-only searches containing words such as `update` inside notes.
- The UI neither showed the interpreted grouping nor explained fallback behavior, and its error suggested a fixed field/operator/value grammar.

## What can be filtered

Only fields visible to the current user are eligible. Text supports partial/exact matches, prefixes/suffixes, lists and exclusions as allowed by its field registry. Numbers and dates support ranges/comparisons; booleans and attachments support their registered presence/value checks.

| Table | Available search data |
| --- | --- |
| Candidates | Candidate ID/name, email, mobile, current designation/employer, experience, location, notice period, relocation willingness, skills, education, LinkedIn/CV availability, source, created/updated dates; assignment consultant, client/mandate IDs, hiring client, submitted role, status, current/expected/offered CTC, joining date and comments. |
| Clients | Client ID/name, consultant, location/region, all stored contact names/phones/emails/LinkedIn/designations, sector, connected/created/updated dates, comments, any/next follow-up dates, overdue/upcoming follow-ups, status, accepted terms, terms model, GSTIN/PAN, invoice address, contract signature/attachment, normalized monetary client value and billing entity. |
| Mandates | Mandate/client IDs, client name, assigned consultant array and consultant count, team lead, role, location, budget/experience ranges, sector, allocation/created/updated dates, JD availability, status and comments. |

## Changed behavior

- Search opts into full prompt preservation, with a 32,000-character metadata ceiling rather than silent truncation. The quoted sentence appears near the beginning. Other AI uses retain their existing prompt behavior.
- Shared interpretation instructions cover conversational wording, shorthand, typos, Hindi/Hinglish, exclusions, nested AND/OR, inclusive versus exclusive bounds, shared units, date periods and missing-versus-false values. Table-specific instructions distinguish current employer from hiring client, current designation from submitted role, the three candidate CTC fields, terms acceptance from contract signature/attachment, and mandate allocation from creation.
- An explicitly unsupported AI response is rejected. A failed structured interpretation cannot silently become a plain keyword search. Local fallback carries a visible notice, and a sort-only fallback cannot discard unparsed conditions.
- All three keyword plans require each retained keyword to match at least one permitted field. They preserve quoted phrases and every meaningful term, within eight terms and 64 generated keyword conditions. Excess terms are rejected instead of silently discarded. Structured AI filters retain the existing 24-node/5-level bounds.
- Each box has a plain-language placeholder and a 600-character input limit. The UI displays the actual interpreted search, including grouping, units and supported sorts.
- Each submission still attempts at most one primary AI request. No repair request or provider retry was added.

## Limits that still apply

- Natural language searches stored fields; it does not inspect the contents of CV/JD/contract files, infer unrecorded facts, score candidate quality, or implement arbitrary cross-table statistics.
- Hidden/unavailable fields remain unavailable. Enum values must map to real statuses/sectors. Ambiguous consultant names still require a unique name.
- Requests are independent; prior chat/search context and the signed-in consultant's identity are not supplied. Use an actual consultant name for ownership searches.
- Candidate AI sorting remains disabled; its existing Sort By control remains available. Clients and Mandates allow only their existing whitelisted sorts, up to two.
- Mandate budgets and experience are stored ranges. Comparisons use the existing bounds/overlap semantics; a matching range need not lie wholly within the requested interval.
- Candidate skills use the stored array-element matching behavior. The AI is instructed to include common spelling variants for technologies, but this does not provide unlimited fuzzy matching of arbitrary stored spellings.
- Client contact fields search all contacts independently. A name clause and an email clause may match different contacts on the same client; same-contact correlation is unavailable. Percentage/slab terms are not monetary client values.
- Existing candidate query safeguards can reject overly broad OR requests spanning candidate and assignment data instead of truncating results.

## Seven difficult manual queries

Use names/companies present in your data where appropriate. Empty results alone do not indicate a parser failure: compare the Applied search explanation with the expected conditions.

1. **Candidates:** Could you find React and Node developers in either Gurgaon or Delhi, with five to nine years of experience, expecting no more than twenty-five lakh a year, who can join within a month, but aren't currently at TCS?
   Expected: both technologies; location alternatives; 5–9 years; expected CTC ≤ ₹25,00,000; notice ≤ 30 days; current employer exclusion. A developer-title condition may also be shown.
2. **Candidates:** Cherry ke candidates dikhao jo Pune ya Bangalore mein hain, relocate karne ko ready hain, lekin Interested aur Not Interested dono status ko exclude karo.
   Expected: consultant Cherry; Pune OR Bangalore/Bengaluru; relocation true; exclude both Interested and Not Interested.
3. **Candidates:** Show people added last month whose email is missing but CV is available, excluding anyone already hired or rejected by the client.
   Expected: full previous calendar month; email missing; CV present; status excludes Hired and Rejected by Client.
4. **Clients:** Tech or fintech accounts in Delhi or Gurgaon with agreed commercials but no contract file, excluding inactive accounts, highest client value first.
   Expected: Technology OR Financial Services; location alternatives; terms accepted; contract attachment missing; exclude Inactive; value descending.
5. **Clients:** Cherry's clients with an overdue follow-up and a signed contract but no uploaded agreement; leave out Not Hiring and Not Converted.
   Expected: consultant Cherry; overdue follow-up true; contract signed true; contract attachment missing; exclude both named statuses.
6. **Mandates:** Open roles for Acme in either Bangalore or Pune, budget at least 20 LPA, assigned to both Cherry and Rahul but not Amit, with a JD attached.
   Expected: Ongoing (P1); client Acme; location alternatives; budget ≥ 20 LPA using stored range bounds; both assignees present and Amit absent; JD present.
7. **Mandates:** Roles allocated last month that are paused or completed, have no JD, and need five to eight years of experience; show the highest budgets first.
   Expected: previous allocation calendar month; Paused (P3) OR Completed; JD missing; experience overlaps 5–8 years; budget descending.
