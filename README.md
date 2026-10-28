# Interview Practice

A resume-based spoken interview app using Next.js, FastAPI, Neon PostgreSQL,
ChromaDB and Groq. Users upload a resume, verify its email address, and practise
one combined technical and HR interview. Recorded answers are transcribed and
scored, with saved feedback available in interview history.

## Status and handoff (28 October 2026)

The retained migration features are implemented. The user confirmed resume
upload/parsing, email verification, saved-resume access, Chroma context, spoken
interviews, Whisper transcription and Orpheus voice work. Interview history is
implemented and tested; its final manual verification is still pending.

The next planned work is moving this application's folders to the repository
root, followed by small readability/refactoring improvements. Do not introduce
new architecture or change behavior as part of that work. This is a working local
application, not a claim of production deployment readiness.

## Features and flow

1. Upload a text-based PDF (maximum 5 MB and 60,000 extracted characters).
   pypdf extracts text; Groq extracts name, email, skills, education and other
   structured details. PostgreSQL saves raw text and parsed JSON.
2. Send a six-digit code to the extracted email through SMTP. On successful
   verification, create or reuse the user, link this resume and issue a session.
   No password, signup form or conventional login page is used. Codes expire in
   10 minutes, allow five attempts and have a 60-second resend cooldown.
3. Returning users with a valid session see their latest linked resume. Sessions
   last seven days. Users must verify again after sign-out or session expiry.
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
8. Interview history lists completed questions, answers, scores and feedback
   across the verified user's linked resumes, newest first, ten per page.
   Expand entries, refresh or load more. Saving an answer refreshes history.
   Signing out clears the displayed private data.

No MCQ, ATS analysis or old dashboard is included in this application. Resume
PDF files and answer recordings are not permanently stored. Unsaved browser
recordings are lost on refresh. History contains text, not audio, and lists
individual turns rather than grouped interview sessions. Scanned PDFs need OCR,
which is not implemented. Legacy Django users/data have not been imported.

## Directory layout

Currently this README and `api`/`web` are under `migration/`. The intended final
layout is the same content directly in the repository root:

```text
api/
  app/                # FastAPI source and SQL schema
  tests/              # unit tests and opt-in integration tests
  requirements.txt
  .env                # private server settings; ignored by Git
  chroma_db/          # persistent resume vectors; ignored by Git
web/
  app/                # Next.js components, API client and styles
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
not an obsolete application folder. Keep all API/web source and lockfiles when
moving them, not only the folders shown in this abbreviated tree.

## Setup and run (PowerShell)

Use Python 3.11 and Node.js 20.9 or newer. The following commands assume the
planned root layout. Until the move, replace `cd api` with `cd migration/api`
and `cd web` with `cd migration/web` when starting from the repository root.

```powershell
cd api
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Create `api/.env` with provider settings (never commit actual values):

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
variables take precedence. Restart the API after changing settings.

From `api`, initialize tables on a new database only as needed:

```powershell
.\.venv\Scripts\python.exe -m app.setup_db
```

Setup is explicit, not automatic at startup. The current script creates missing
tables/columns/indexes and preserves rows. Moving folders does not require a new
database or table recreation.

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
| `api/app/auth.py`, `mail.py` | Email codes, automatic users, sessions, ownership and SMTP |
| `api/app/rag.py` | Local persistent Chroma embeddings and scoped context retrieval |
| `api/app/ai.py` | Shared Groq interview client |
| `api/app/interviews.py` | Questions, grading, audio submission, question voice and history |
| `api/app/speech.py` | Whisper transcription and Orpheus WAV synthesis/chunk joining |
| `web/app/page.js` | Main page, resume and verified-user state |
| `web/app/EmailVerification.js` | Code request/verification and sign-out |
| `web/app/ResumeContext.js` | Resume-context search interface |
| `web/app/SpokenInterview.js` | Active interview and recording workflow |
| `web/app/microphone.mjs` | Microphone level/silence monitor |
| `web/app/questionAudio.mjs` | Question audio loading, replay, cancellation and cleanup |
| `web/app/InterviewHistory.js` | Read-only paginated completed-answer list |
| `web/app/api.js` | Credentialed API requests and error handling |
| `web/app/globals.css` | Shared styles |

Groq models: `openai/gpt-oss-120b` for parsing/questions/grading,
`whisper-large-v3-turbo` for transcription, and
`canopylabs/orpheus-v1-english` with voice `autumn` for question speech. Long
questions are split at word boundaries and PCM WAV output is joined server-side.
Audio responses are private/no-store. Answer uploads are limited to 10 MB and
five minutes, supporting browser WebM/Ogg/MP4/WAV signatures.

PostgreSQL tables: `app_users`, `resume_uploads`, `email_verifications`,
`user_sessions`, `interview_turns`. Turns hold question, answer, score, feedback,
kind, difficulty and timestamps; transcript/audio hash support retries. Session
tokens are hashed, verification codes use salted PBKDF2 hashes. Authenticated
queries scope access to the verified user. Chroma collection `resume_context_v1`
lives at `api/chroma_db`, resolved relative to the source location.

Main routes: `POST /api/resumes`, `GET /api/resumes/latest`,
`POST /api/resumes/{id}/context`; `/api/auth/send-code`, `/verify-code`, `/me`,
`/logout`; `POST /api/interview/question`, `/{id}/audio-answer`, `/{id}/speech`,
and `GET /api/interview/history`. The text `/{id}/answer` endpoint remains for
compatibility; the current UI submits recordings.

## Checks and manual verification

Latest implementation checks: 54 backend tests passed, including opt-in Neon
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
npm run build
```

After moving, verify: health/db; upload and parsed details; email code; resume
restoration after refresh; context search; question playback; recording,
transcription and score; history after refresh; sign-out and a different account's
isolation. If an endpoint returns Not Found, inspect `/docs` and ensure the API
process is serving the current code with reload enabled.

## Root move and cleanup checklist

1. Manually verify interview history before calling the retained migration done.
2. Stop API and Next.js before moving folders or copying live vector databases.
3. Keep `.git/`. Make an external backup of the current project, including ignored
   root `.env`, `db.sqlite3`, old `chroma_db`, and any other legacy user files.
   These legacy records have NOT been imported into PostgreSQL. Deleting them
   without a backup loses access to that old data. Keep backups private.
4. Preserve `migration/api/.env`, `migration/api/chroma_db` and any
   `migration/web/.env.local`. Neon data stays remote; preserve its connection
   settings and take an appropriate database backup before destructive DB work.
   A Git commit alone does not back up ignored configuration or database files.
5. Move `api`, `web`, this README, `preview.png` and `sample-resume.pdf` to the
   root. Merge `.gitignore` rules, preserving private/runtime exclusions.
6. Recreate `api/.venv` at its final location; virtual environments can contain
   absolute paths. Reinstall web dependencies with `npm ci` if necessary and
   regenerate `.next` rather than treating build output as source.
7. Update old path references in scripts/editor settings and rerun the checks
   and manual flow above before removing the backup or legacy source.

The root `.env` is currently a fallback for Groq in `ai.py` and `resumes.py`.
On inspection, **all needed settings including GROQ_API_KEY were already present
in `migration/api/.env`**, so that fallback was not needed. Moving the code changes
the meaning of its fixed `parents[3]` path: rely on the complete backend `.env`,
and remove the legacy fallback in a small subsequent code change. The Chroma
integration test also references the legacy directory for a preservation check;
review that reference after the move. Existing source-relative backend `.env`,
Chroma and schema paths continue to work when the entire `api` folder moves.

## Working agreement for future changes

Keep code straightforward and dependencies minimal. Explain behavior/storage/auth
changes before implementing them. Work one feature or refactoring step at a time,
run relevant checks, give manual verification instructions, then stop for the
user's approval. Preserve user data. Do not silently replace the voice flow,
models, interview behavior or authentication. Read `web/AGENTS.md` and the bundled
Next.js docs before editing frontend code. Refactor for readability without
introducing unnecessary service layers or a full rewrite.
