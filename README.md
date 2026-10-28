# Interview Practice

A resume-based spoken interview app using Next.js, FastAPI, Neon PostgreSQL,
ChromaDB and Groq. Users upload a resume, verify its email address, and practise
one combined technical and HR interview. Recorded answers are transcribed and
scored, with saved feedback available in interview history.

## Status and handoff (28 October 2026)

The retained migration features are implemented. The user confirmed resume
upload/parsing, email verification, saved-resume access, Chroma context, spoken
interviews, Whisper transcription, Orpheus voice and saved interview history.

Steps 1-5 (root-path cleanup, frontend organization, route shell, returning-user
access and saved-resume browsing) are manually verified. Steps 4-5 added
returning-user email-code sign-in, expiry recovery, owned
saved-resume browsing and safer replacement uploads. The additive `sign_in_codes`
table has been applied to this workspace's configured database. New-account and
resume-ownership rules remain resume-email verification based. The shared UI
foundation is manually verified. Desktop Update 1 now makes Home the returning-user
dashboard and uses Dashboard/Resumes/History navigation. This update awaits manual
verification before further page redesigns. Tab-switch alert changes and unsaved-work protection remain deferred.
This is a working local
application, not a claim of production deployment readiness.

## Features and flow

1. Upload a text-based PDF (maximum 5 MB and 60,000 extracted characters).
   pypdf extracts text; Groq extracts name, email, skills, education and other
   structured details. PostgreSQL saves raw text and parsed JSON.
2. Send a six-digit code to the extracted email through SMTP. On successful
   verification, create or reuse the user, link this resume and issue a session.
   No password, signup form or conventional login page is used. Codes expire in
   10 minutes, allow five attempts and have a 60-second resend cooldown.
3. Returning users with a valid session see their latest linked resume by default.
   Sessions last seven days. After sign-out or expiry, existing users can sign in
   with a code sent to their previously verified email, without another upload.
   Sign-in codes expire after 10 minutes, allow five attempts and have a 60-second
   resend cooldown. Their challenges are separate from resume-verification codes;
   sign-in does not create accounts or change resume ownership. Public send-code
   responses are generic for unknown addresses, cooldown and delivery failures.
   A protected API/speech 401 clears private UI state and routes to sign-in with
   an allowlisted return destination. Recordings are not retained or auto-submitted.
4. Resume context is indexed lazily in local ChromaDB. Text is split into
   500-character chunks with 50-character overlap and embedded locally using
   all-MiniLM-L6-v2. Retrieval selects up to three relevant passages and always
   filters by both user ID and resume ID. PostgreSQL is the source of truth.
5. Start one combined interview. Technical and HR questions alternate, starting
   with technical, using resume context and avoiding recent repeated questions.
   There is at most one pending question per user/resume. Starting again after
   refresh resumes that pending question.
6. Groq Orpheus reads questions in the Autumn voice. Toggle, replay and stop
   controls remain available. Playback stops before microphone recording.
7. Browser MediaRecorder captures the chosen microphone, with an input meter and
   silent-recording guard. Submit the recording to FastAPI; Groq Whisper returns
   text, then the interview model grades it from 0 to 10 and generates feedback.
   The frontend displays the transcript and result. Retries reuse cached
   transcription/results where possible. The UI does not use browser speech
   recognition or an editable answer field.
8. Saved resumes can be browsed, ten at a time, with owned detail retrieval.
   Resume selection is carried in `?resume=<id>` on Resumes and Interview links,
   so direct visits and refresh can retrieve that owned resume. Replacement
   uploads are separate unverified drafts; invalid files, cancellation and failed
   parsing do not clear the active verified resume. A draft becomes active only
   after its email is verified. Dismissing a draft does not delete the stored row.
9. Interview history lists completed questions, answers, scores and feedback
   across the verified user's linked resumes, newest first, ten per page.
   Expand entries, refresh or load more. Saving an answer refreshes history.
   Signing out clears the displayed private data.

No MCQ, ATS analysis or old dashboard is included in this application. Resume
PDF files and answer recordings are not permanently stored. Unsaved browser
recordings are lost on refresh. History contains text, not audio, and lists
individual turns rather than grouped interview sessions. Scanned PDFs need OCR,
which is not implemented. Legacy Django users/data have not been imported.

## Directory layout

The application lives directly in the repository root:

```text
api/
  app/                # FastAPI source and SQL schema
  tests/              # unit tests and opt-in integration tests
  requirements.txt
  .env                # private server settings; ignored by Git
  chroma_db/          # persistent resume vectors; ignored by Git
web/
  app/                # App Router pages and shared styles
    _components/      # Shared session provider, header, footer and access gate
    access/           # Email verification page and component
    resumes/          # Resume page, upload, details and context components
    interview/        # Interview page, spoken interview and audio utilities
    history/          # History page and completed-answer list
  lib/                # Shared API client
  tests/              # microphone and question-playback checks
  package.json
  package-lock.json
  AGENTS.md           # Next.js-specific contributor instructions
.gitignore
README.md
preview.png
sample-resume.pdf
```

Keep the existing root `.git/` directory. It contains repository history and is
not an obsolete application folder. The tree above is abbreviated; retain all
API/web source and lockfiles.

## Setup and run (PowerShell)

Use Python 3.11 and Node.js 20.9 or newer. The following commands start from the
repository root and use the current `api` and `web` folders.

```powershell
cd api
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

For a new checkout, create `api/.env` with provider settings (never commit actual
values). Preserve an existing configuration rather than replacing it:

```dotenv
DATABASE_URL="your-neon-postgresql-connection-string"
GROQ_API_KEY="your-groq-api-key"
SMTP_HOST="your-smtp-host"
SMTP_PORT=587
SMTP_USERNAME="your-smtp-username"
SMTP_PASSWORD="your-smtp-password-or-app-password"
SMTP_FROM="your-approved-sender@example.com"
SESSION_COOKIE_SECURE=false
```

Keep Neon's supplied SSL/channel-binding options. SMTP 587 uses STARTTLS; 465
uses SSL. All credentials belong on the backend, never in `NEXT_PUBLIC_` values.
`db.py` loads `api/.env` relative to its own location. Existing process environment
variables take precedence. Groq clients use this loaded environment; no parent
directory or legacy `.env` fallback is used. Restart the API after changing settings.

From `api`, initialize tables on a new database only as needed:

```powershell
.\.venv\Scripts\python.exe -m app.setup_db
```

Setup is explicit, not automatic at startup. The current script creates missing
tables/columns/indexes and preserves rows. Moving folders does not require a new
database or table recreation.

After updating an existing checkout for Steps 4-5, run the same setup command once
to create the additive `sign_in_codes` table. It has already been applied in this
workspace. The new table references existing account emails; existing application
rows are not updated or deleted by this addition.

Start the API from `api`:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --reload-dir app --host 127.0.0.1 --port 8001
```

In another terminal, from the repository root:

```powershell
cd web
npm ci
npm run dev
```

Open http://127.0.0.1:3000 . API health is http://127.0.0.1:8001/health ; database
health is http://127.0.0.1:8001/health/db . API documentation is at
http://127.0.0.1:8001/docs . Stop each server with Ctrl+C.

The frontend defaults to the current browser hostname on port 8001. Optional
`web/.env.local`: `NEXT_PUBLIC_API_URL=http://127.0.0.1:8001`. Use the same hostname
consistently for cookies. Backend allowed origins currently cover localhost and
127.0.0.1 on port 3000. Deployment needs explicit origin/cookie configuration.
Microphone access requires localhost or HTTPS. First Chroma use may download the
local embedding model and take longer than subsequent requests.

## Code map for the next developer/AI

| File (relative to application root) | Responsibility |
| --- | --- |
| `api/app/main.py` | App entry, routers, CORS, health endpoints |
| `api/app/db.py` | Load backend settings, PostgreSQL connections |
| `api/app/schema.sql`, `setup_db.py` | Explicit idempotent database setup |
| `api/app/resumes.py` | PDF upload/extraction, structured parsing, latest resume and context access |
| `api/app/auth.py`, `mail.py` | Separate returning sign-in/resume-link codes, automatic users, sessions, ownership and SMTP |
| `api/app/rag.py` | Local persistent Chroma embeddings and scoped context retrieval |
| `api/app/ai.py` | Shared Groq interview client |
| `api/app/interviews.py` | Questions, grading, audio submission, question voice and history |
| `api/app/speech.py` | Whisper transcription and Orpheus WAV synthesis/chunk joining |
| `web/app/page.js` | First-visit introduction and returning-user Home dashboard |
| `web/app/_components/RecentPractice.js` | Latest three real history entries, scoped sample summary, loading/error/empty states |
| `web/app/history/InterviewHistoryEntry.js` | Shared expandable saved-answer rendering for Dashboard and History |
| `web/app/layout.js`, `_components/AppHeader.js`, `_components/AppFooter.js` | Shared navigation, account controls and API status |
| `web/app/_components/SessionProvider.js` | Session restoration/expiry, active resume and separate draft, account transitions, selection and stale-response guards |
| `web/app/_components/SessionGate.js` | Loading/error/access states for Interview and History; backend remains the authorization authority |
| `web/app/access/page.js`, `resumes/page.js`, `interview/page.js`, `history/page.js` | Route composition around existing features |
| `web/app/access/EmailVerification.js`, `SignInForm.js` | Resume linking and returning-user sign-in through separate code flows |
| `web/app/resumes/ResumeUpload.js` | Upload form and status markup; state/handlers live in the shared provider |
| `web/app/resumes/ResumeDetails.js` | Saved/extracted resume details markup |
| `web/app/resumes/ResumeContext.js` | Resume-context search interface |
| `web/app/resumes/SavedResumes.js`, `_components/ResumeSelection.js` | Paginated owned-resume list and query-based detail selection |
| `web/app/interview/SpokenInterview.js` | Active interview and recording workflow |
| `web/app/interview/microphone.mjs` | Microphone level/silence monitor |
| `web/app/interview/questionAudio.mjs` | Question audio loading, replay, cancellation and cleanup |
| `web/app/history/InterviewHistory.js` | Read-only paginated completed-answer list |
| `web/lib/api.js`, `navigation.mjs` | Credentialed requests, 401 notification, stale-response protection and allowlisted return destinations |
| `web/app/globals.css` | Shared palette/spacing/radius tokens, existing component styles and responsive navigation |

Groq models: `openai/gpt-oss-120b` for parsing/questions/grading,
`whisper-large-v3-turbo` for transcription, and
`canopylabs/orpheus-v1-english` with voice `autumn` for question speech. Long
questions are split at word boundaries and PCM WAV output is joined server-side.
Audio responses are private/no-store. Answer uploads are limited to 10 MB and
five minutes, supporting browser WebM/Ogg/MP4/WAV signatures.

PostgreSQL tables: `app_users`, `resume_uploads`, `email_verifications`,
`user_sessions`, `interview_turns`, `sign_in_codes`. Turns hold question, answer, score, feedback,
kind, difficulty and timestamps; transcript/audio hash support retries. Session
tokens are hashed, verification codes use salted PBKDF2 hashes. Authenticated
queries scope access to the verified user. Chroma collection `resume_context_v1`
lives at `api/chroma_db`, resolved relative to the source location.

Main routes: `POST /api/resumes`, `GET /api/resumes`, `GET /api/resumes/{id}`,
`GET /api/resumes/latest`,
`POST /api/resumes/{id}/context`; `/api/auth/send-code`, `/verify-code`, `/me`,
`/logout`, `/sign-in/send-code`, `/sign-in/verify-code`; `POST /api/interview/question`, `/{id}/audio-answer`, `/{id}/speech`,
and `GET /api/interview/history`. The text `/{id}/answer` endpoint remains for
compatibility; the current UI submits recordings.

## Checks and manual verification

Desktop Update 1: 34 frontend tests passed (18 route/rendering, five session/API,
11 microphone/playback); the Next.js production build passed for every existing
route. Browser checks verified the signed-out Home at a 1440px desktop viewport,
Resumes/History navigation, sign-in access and return to Dashboard. Signed-in
activity/account changes still need manual runtime verification. No backend,
schema, provider or data changes were made in this UI update.

Home renders a dashboard after session restoration instead of redirecting signed-in
visitors to Resumes. This is the explicit redirect exception needed to make `/`
the dashboard. Other sign-in defaults and expiry return destinations remain;
Dashboard's sign-in links explicitly request `next=/`, which is now allowlisted.
No automatic interview question or speech requests occur on Home.


UI foundation checks: all 26 frontend checks passed. Next.js compiled successfully
but prerendering failed with the existing Windows `.next` directory permission
error; the elevated retry was declined. The browser preview could not attach, so
desktop/mobile visual verification remains manual. Token contrast checks passed
for primary text (9.55:1), secondary text (5.67:1), control borders (3.31:1), and
focus rings against the page background (4.67:1). No API or workflow changes are
part of this UI step.

Steps 4-5 checks: seven socket-free backend logic tests passed with mocked storage;
26 frontend checks passed (10 route rendering, five session/API recovery and 11
microphone/playback). An earlier Next.js production build passed for all five app
routes. After the final account-transition safeguards, compilation passed but the
final build hit Windows `EPERM` while creating generated `.next` output; its
outside-sandbox retry was declined, so the final build remains unverified.
The additive sign-in table was applied successfully. The full HTTP backend suite
stalled in the Windows sandbox; its outside-sandbox retry was declined, so the
new HTTP endpoint tests and full backend regression suite remain unverified for
this step. No live SMTP/Groq calls or synthetic PostgreSQL user records were used.

For Steps 4-5, manually verify existing-email sign-in; unknown-email messaging;
wrong/expired codes and resend; sign-out; protected-request session expiry and
return destination; multi-resume selection/refresh; invalid/failed replacement
uploads; draft verification; and pending-question recovery on an older resume.

Route-shell checks (28 October 2026): all 11 microphone/playback tests and seven
route-rendering tests passed. The route tests cover access gates, restoration
states, verification code rendering, resume actions, interview/history rendering
and active navigation using mocked session/router boundaries; they do not exercise
browser effects or real authentication. Next.js compiled successfully, but the
production build could not finish prerendering because Windows denied creation
of a generated `.next` directory. Permission to retry outside the sandbox was
declined; a complete production build remains unverified for this step.

Manually check direct visits and refresh on `/`, `/access`, `/resumes`,
`/interview` and `/history`; navigation/back/forward; upload-review-verification;
signed-in resume restoration; playback/recording/submission; history; and sign-out
from another page. Confirm the shared header at mobile widths and by keyboard.

Frontend organization checks (28 October 2026): all 11 microphone/playback tests
and the Next.js production build passed. Source comparison confirmed unchanged
upload/details markup, main-page state and handlers, audio utilities, API helper,
styles and dependencies. Existing feature components changed only their API
import paths. The build still exposes only the home page (plus Next.js's
not-found page). The user confirmed this organization step works manually.

Root-layout cleanup checks (28 October 2026): 48 backend tests passed and six
database/Chroma integration tests were skipped to avoid writing application data.
Configuration/path checks and mocked Groq parsing/client checks passed. No live
provider calls or schema setup were run; frontend files were unchanged.

Previously recorded implementation checks: 54 backend tests passed, including opt-in Neon
and Chroma integration checks; 11 microphone/playback tests passed; Next.js
production build passed. These were run before the proposed folder move.

From `api`:

```powershell
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -v
```

Integration tests are skipped by default. Set `RUN_DB_TESTS=1` and
`RUN_CONTEXT_TESTS=1` to include them. They require a reachable configured
PostgreSQL database and local embeddings. They add synthetic records and test
vector data; prefer a separate test database. AI/email calls are mocked in these
checks. On this Windows environment TestClient sockets have required running
outside the restricted Codex sandbox.

From `web`:

```powershell
npm run test:audio
npm run test:voice
npm run test:routes
npm run test:session
npm run build
```

For regression verification, check: health/db; upload and parsed details; email code; resume
restoration after refresh; context search; question playback; recording,
transcription and score; history after refresh; sign-out and a different account's
isolation. If an endpoint returns Not Found, inspect `/docs` and ensure the API
process is serving the current code with reload enabled.

## Root-layout configuration and data preservation

The root-folder move is complete; no further folder move is needed. Backend
configuration, Chroma and schema paths resolve relative to `api` source files.
The Chroma integration test uses separate `api/chroma_test_db` storage and checks
that the live `api/chroma_db/chroma.sqlite3` file remains unchanged. Run it while
the app is idle to avoid unrelated live writes affecting that check.

Preserve `api/.env`, `api/chroma_db`, any `web/.env.local`, all PostgreSQL data,
and any private backups or legacy user files kept outside this source tree.
Legacy Django records have not been imported. A Git commit does not back up
ignored configuration or database files. Stop the servers before copying live
vector storage; no schema setup, data cleanup or database recreation is needed
for this path cleanup.

If a moved virtual environment stops working, recreate `api/.venv` at its current
location and reinstall requirements. Regenerate `.next` rather than moving build
output; reinstall web dependencies only if needed.

## Working agreement for future changes

Keep code straightforward and dependencies minimal. Explain behavior/storage/auth
changes before implementing them. Work one feature or refactoring step at a time,
run relevant checks, give manual verification instructions, then stop for the
user's approval. Preserve user data. Do not silently replace the voice flow,
models, interview behavior or authentication. Read `web/AGENTS.md` and the bundled
Next.js docs before editing frontend code. Refactor for readability without
introducing unnecessary service layers or a full rewrite.

For the upcoming UI/UX work, maintain a consistent, sleek visual system. Define
shared theme colors, typography, spacing, radii, shadows and interaction/focus
states as CSS custom properties and reusable component styles in
`web/app/globals.css`. All pages should reuse those patterns rather than inventing
page-specific palettes or spacing. Establish the tokens during the agreed UI
step. The route shell now exposes the existing palette and shared spacing/radii
as tokens; subsequent UI work should extend these rather than select a separate
theme per page.

## Current navigation and recovery limits

- `/` introduces the app to signed-out visitors and stays on Home for returning
  users, showing their active resume and recent practice. Main navigation is
  Dashboard, Resumes and History; Interview highlights the Dashboard section.
- `/resumes` uploads/reviews drafts, lists linked resumes and offers scoped context
  search for the selected active resume. `?resume=<id>` restores an owned selection.
- `/access` signs existing users in through email codes or verifies an uploaded
  resume to create/reuse its account and link it. There are no passwords.
- `/interview?resume=<id>` uses the selected owned resume with the unchanged
  interview/audio component. Starting again retrieves a pending question.
- `/history` shows completed turns across linked resumes using the existing API.
- Shared state persists across Next.js links and back/forward navigation, not a
  full reload. No resume text, code, token or recording is saved in browser storage.
  Refresh before verification still loses the unlinked upload draft.
- Replacement drafts remain separate until verified. Neither draft dismissal nor
  sign-out deletes stored uploads; no new retention/deletion policy was introduced.
- Leaving Interview or session-expiry recovery releases the microphone/player and
  loses unsaved recordings. A visible reminder explains this; the leave-warning
  guard and tab-switch alert changes are deferred to the UI phase.
- Expiry is detected on a protected request returning 401, rather than by polling.
  Sign-in returns to the requested app route but never resubmits an answer.

## Shared UI design system and rollout

`web/app/globals.css` is the source of truth for the visual system: a light warm
background, forest-green primary actions, white surfaces and muted secondary
text. Use `--color-*` semantic tokens, `--font-sans` and `--text-*` typography,
the `--space-*` four-pixel spacing scale, `--radius-*`, `--shadow-*`, shared content
widths, control height and motion duration. Use the system font stack; no remote
font, icon library or new dependency is required.

Reuse `.page-heading`, `.upload-card`, `.results`, `.page-actions`, `.file-label`,
`.context-input`, `.code-input`, `.preview-note` and `.error` before creating
page-specific variants. Shared buttons use at least 44px touch targets; text
inputs use 16px type, visible focus rings and distinct disabled states. Preserve
native form/audio semantics. Navigation keeps all three labels visible, moves
below the brand/account row at 900px, and fits the content width below 540px.
Reduced-motion preferences disable decorative transitions. Avoid fixed widths
that can overflow at 320px or when zoomed.

UI step 1 covers only this shared foundation and the header brand mark. Verify
navigation/active states, long account emails, keyboard focus, forms, error states,
and all five routes at desktop and 320/375/768px widths before continuing.
Subsequent UI steps should handle Home/access, Resumes, Interview/feedback, and
History in separately verified increments. Keep authentication, data ownership,
models, scoring and the working audio pipeline unchanged during visual work.

### Desktop Update 1: Home and shared navigation

The dashboard uses the existing warm palette, system font and shared surface,
control, border, radius and spacing tokens. Returning users see their active
resume, one Start Practicing action and the latest three completed answers from
`GET /api/interview/history?limit=3&offset=0`. The summary labels the returned
sample, latest score and latest practice date. It does not claim lifetime totals,
session counts or average scores. Expandable answers reuse History's renderer.

Signed-out users see one Upload Resume CTA and three short onboarding steps.
Unverified drafts offer a verification link. A signed-in user without a resume
gets an upload prompt rather than a broken interview action. Restoration errors
and recent-history errors have separate retry actions. Account changes unmount
private activity and pending activity responses are ignored after unmount.

Verify: signed-out Home/upload/sign-in links; signed-in Home staying at `/`;
active resume matching Start Practicing's resume ID; actual recent scores and
expandable transcript/feedback; no-history and no-resume accounts; failed-history
retry; sign-out clearing activity; expiry returning to Dashboard after sign-in;
and existing Resumes, History and Interview navigation. Other page redesigns are
outside this update; desktop is the focus, with basic overflow protection only.
