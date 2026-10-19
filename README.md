# Site Office Platform

An Android field app and a cloud backend for running house and building
sites in Pakistan, for **any builder and any client**. It is built to stop
the usual cheats: ghost workers, proxy attendance, material leaving the
store without record, inflated bills and fake tanker slips.

It is the production version of the Villa 31 site office web app. The web
app stays as the owner's dashboard until its screens are moved onto this
backend (see *Next steps*).

```
 Android app (Expo / React Native)            Supabase (PostgreSQL + Storage + Edge Functions)
 ───────────────────────────────────          ─────────────────────────────────────────────────
 live camera ─ photo + GPS fix ──upload──▶  storage: evidence/<project>/<user>/<uuid>.jpg
                                 ──call───▶  ingest-evidence  → re-hash, bind phone, Play Integrity
                                                               → evidence row (server time, GPS
                                                                 distance, flags) — service role only
 badge QR scan ─ mark_attendance()────────▶  attendance (only via this function)
                                 ──call───▶  verify-face      → Claude compares with registered photo
 release / GRN / tanker / count ─insert───▶  triggers refuse unregistered people, bad photos,
                                             over-issue, reused photos; stock is append-only
 bill photos ────────────────────call───▶  read-document    → Claude reads the bill vs the record
 daily log ─────────────────────call───▶  weather (Open-Meteo for the site's coordinates)
```

## What stops which cheat

| Cheat | Control | Where |
|---|---|---|
| Old photo or a photo from WhatsApp / gallery | The app has no gallery access at all (media permissions blocked). Every photo comes from the live camera, with a fresh GPS fix. The server compares *its own* receive time with the capture time and flags anything older than 15 minutes. | `app.json`, `LiveCamera.tsx`, `evidence_flags()` |
| Photo taken away from site | The server computes the distance from the site's coordinates; outside the radius it is flagged, and stock entries are refused. | `evidence_flags()`, `assert_clean_evidence()` |
| Fake GPS app | Android's mock-location flag is refused on the phone and flagged on the server. | `evidence.ts`, `evidence_flags()` |
| Using someone else's phone, or an unapproved phone | Each phone is bound to the user who first used it. The owner must approve each phone; photos from unknown, unapproved or borrowed phones are flagged and refused for stock. | `devices`, `ingest-evidence` |
| Modified app or rooted phone | Optional Google Play Integrity check, bound to the photo's hash. | `ingest-evidence/integrity.ts` |
| Faking records through the API | Clients cannot write evidence at all. Only the ingest function can, after re-hashing the uploaded file. | RLS on `evidence` |
| Proxy attendance or ghost workers | Attendance needs a live scan of the worker's QR pass, a live face photo on site, and an AI face match against the registered photo. It goes in only through `mark_attendance()`. Anything doubtful is saved as *flagged* and not counted until the owner decides. | `mark_attendance()`, `verify-face` |
| Releasing to "someone" | Releases, returns and losses must name a **registered, active** person whose BTK card and CNIC are valid. The authoriser must be registered staff (not labour, guard, cook or driver). The store keeper is stamped from the signed-in user. | `stock_moves_rules()` |
| Over-issue or "borrowing" from stock | Can't release more than is on hand; tools can't be returned beyond what the person holds. | `stock_moves_rules()` |
| Re-using one photo for many entries | Each evidence photo can be used once. | `assert_clean_evidence()` |
| Editing history | Stock, receipts, tankers, counts and attendance evidence are append-only; corrections are owner-signed adjustments. Every change is in `audit_log`. | RLS, `attendance_update_guard()`, `audit_row()` |
| Inflated or fake bills | A bill scan is mandatory for every receipt and every water tanker; Claude reads it and compares it with the entry and the budget rate. | `grns`, `water_tankers`, `read-document` |
| Self-promotion to "verified" | People who register themselves stay *pending* until the owner's side verifies them. Only the owner approves phones, suppliers and POs. | `people_rules()`, `devices_rules()`, `suppliers_rules()`, `po_rules()` |

All of these rules are tested: `supabase/tests/10_scenario.sql` runs 33 checks against the real migrations (all pass).

## Repository

```
supabase/
  migrations/   core schema · rules, RLS, views · storage buckets
  functions/    ingest-evidence · verify-face · read-document · weather
  tests/        local stubs + 33-check scenario test
app/            Expo SDK 53 Android app (TypeScript, expo-router)
tools/          print-badges.mjs — QR site passes as PDF
```

## Set up (development team)

1. **Supabase project.** Create one at supabase.com (Singapore or Mumbai region is closest to Pakistan), or self-host.
2. **Database.**
   - Run `supabase link --project-ref <ref>`, then `supabase db push`. This applies the three migrations and creates the private `evidence` and `contracts` buckets.
3. **Sign-in.**
   - In Auth, enable Phone OTP with an SMS provider that delivers to Pakistani numbers (Twilio, MessageBird, or Vonage). You can also enable Email OTP.
   - Turn off public sign-ups if only invited people should get in. Members are added by the owner.
4. **Functions.**
   - Deploy them: `supabase functions deploy ingest-evidence verify-face read-document weather`.
   - Set the secret `supabase secrets set ANTHROPIC_API_KEY=…`, and optionally `ANTHROPIC_MODEL`.
   - To turn on Play Integrity, also set `PLAY_INTEGRITY_PACKAGE=pk.siteoffice.app`, `PLAY_INTEGRITY_SA_JSON='<service account json>'` and `PLAY_INTEGRITY_REQUIRED=true`.
5. **First project.** Sign in once on the app, then as that user:
   - insert an `organizations` row and a `projects` row (name, address, `site_lat`, `site_lng`, `site_radius_m`);
   - the creator becomes the owner automatically;
   - add members with their roles to `project_members`.
6. **Register people and print passes.**
   - Register everyone in `people` with CNIC and BTK card, and upload their photo and CNIC through the app.
   - Then run `node tools/print-badges.mjs <project_id> passes.pdf`.
7. **Android app.**
   - Put the Supabase URL and anon key in `app/app.json` → `extra`, or in `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
   - Then run `npm install`, `npx eas build -p android --profile preview` for an installable APK, or `--profile production` for the Play Store.
8. **Approve phones.** When each supervisor or store keeper takes their first photo, their phone appears in `devices`; set `approved = true`.

### Checks you can run

```bash
# database rules (needs a scratch PostgreSQL 15+)
psql -d scratch -f supabase/tests/00_local_stubs.sql \
     -f supabase/migrations/20261019000100_core.sql \
     -f supabase/migrations/20261019000200_security.sql \
     -f supabase/migrations/20261019000300_storage.sql \
     -f supabase/tests/10_scenario.sql        # prints 33 × PASS

cd app && npx tsc --noEmit                      # type-check the app
npx expo export --platform android              # bundle check
deno check supabase/functions/*/index.ts        # type-check the functions
```

## The field app

| Screen | Who | What it enforces |
|---|---|---|
| Register yourself | everyone, at first sign-in | Full details: name, CNIC, phone, address, live face photo, CNIC photos. Stays pending until verified. |
| Attendance | owner side, site supervisor, store keeper | QR pass scan → live face photo → server face match → *verified* or *flagged*. |
| Release material | store keeper, supervisors, builder | Receiver by QR pass only; authoriser from registered staff; live photo; stock limit. Covers tools (check-out, return, lost) and canteen items. |
| Receive goods | same | Against an approved PO, or a shop purchase (canteen, petty) with vendor. Bill scan is mandatory; the AI reads it. |
| Water tanker | site staff | Tanker photo with plate plus the tanker bill scan, both mandatory; TDS warning above 1,000 ppm. |
| Stock count | site staff | Live photo of the stack; the book quantity is filled by the server, so the difference can't be typed away. |
| Daily log | supervisors, builder | Weather from Open-Meteo; verified labour from attendance; staff from the register; work done and planned from the programme; photos. |

The app works in Urdu or English. If there's no signal, photos are kept on
the phone and sent later; the server then marks them as late, for the owner
to review.

## Next steps

- **Owner / builder web portal on this backend.** Port the Villa 31 web app's screens (dashboard, Gantt, procurement, inspections, checklists, contracts, analysis) to read and write these tables. Until then, the web app remains the owner's dashboard.
- **Play Integrity on the phone.** Add a native module that requests a Standard Play Integrity token with `requestHash = sha256` of each photo, and send it as `integrity_token`. The server side is already written.
- **Consumption and pilferage analysis.** The views `v_consumption` and `v_tool_holdings` hold the numbers; schedule a daily AI review (Supabase cron calling a function) that writes findings for the owner.
- **Data from Villa 31.** Export the web app's records with Claude and load them into these tables. Workers must be re-registered so they get new QR passes; the old `V31|…` badges are not accepted.

## Notes

- Face matching uses the Anthropic API. Explain to workers that their registered photo is used to confirm attendance, and keep the `evidence` bucket private (it is by default).
- CNIC numbers are visible in full only to the owner and the owner's supervisor; everyone else sees the masked `people_directory`.
