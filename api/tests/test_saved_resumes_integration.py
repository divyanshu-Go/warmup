"""Opt-in ownership checks against Neon; no email or AI calls."""
import os
from unittest import TestCase, skipUnless
from uuid import uuid4

from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from app.auth import hash_token
from app.db import get_connection
from app.main import app


@skipUnless(os.getenv('RUN_DB_TESTS') == '1', 'Set RUN_DB_TESTS=1 to test against Neon')
class SavedResumeOwnershipTests(TestCase):
    def test_latest_resume_is_scoped_to_verified_session(self):
        users = [uuid4(), uuid4(), uuid4()]
        tokens = [uuid4().hex + uuid4().hex for _ in users]
        old_resume, latest_resume, foreign_resume, unlinked_resume = [uuid4() for _ in range(4)]
        email = f'saved-resume-{users[0].hex}@example.com'
        with get_connection() as connection:
            for user_id, token in zip(users, tokens):
                connection.execute('INSERT INTO app_users (id, email, name) VALUES (%s, %s, %s)',
                                   (user_id, f'saved-resume-{user_id.hex}@example.com', 'Saved Resume Test'))
                connection.execute("INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES (%s, %s, CURRENT_TIMESTAMP + INTERVAL '1 day')",
                                   (hash_token(token), user_id))
            for resume_id, owner, days in [(old_resume, users[0], 3), (latest_resume, users[0], 2),
                                           (foreign_resume, users[1], 1), (unlinked_resume, None, 0)]:
                connection.execute(
                    """INSERT INTO resume_uploads (id, filename, raw_text, parsed_data, user_id, created_at)
                       VALUES (%s, %s, %s, %s, %s, CURRENT_TIMESTAMP - (%s * INTERVAL '1 day'))""",
                    (resume_id, 'saved-access-test.pdf', 'Synthetic saved-resume ownership test',
                     Jsonb({'name': 'Test', 'email': email, 'skills': ['Python']}), owner, days),
                )

        with TestClient(app) as client:
            self.assertEqual(client.get('/api/resumes/latest').status_code, 401)
            client.cookies.set('interview_session', tokens[0])
            first = client.get('/api/resumes/latest')
            self.assertEqual(first.status_code, 200)
            self.assertEqual(first.json()['resume']['id'], str(latest_resume))
            self.assertEqual(first.headers['cache-control'], 'no-store')
            self.assertNotIn('raw_text', first.json()['resume'])
            # Client-supplied identity or resume parameters cannot change ownership.
            tampered = client.get(f'/api/resumes/latest?user_id={users[1]}&resume_id={foreign_resume}')
            self.assertEqual(tampered.json()['resume']['id'], str(latest_resume))
            # Repeated requests restore the same record without generating new uploads.
            self.assertEqual(client.get('/api/resumes/latest').json(), first.json())

        with TestClient(app) as other:
            other.cookies.set('interview_session', tokens[1])
            self.assertEqual(other.get('/api/resumes/latest').json()['resume']['id'], str(foreign_resume))
        with TestClient(app) as empty:
            empty.cookies.set('interview_session', tokens[2])
            self.assertEqual(empty.get('/api/resumes/latest').json(), {'resume': None})
            self.assertEqual(empty.post('/api/auth/logout').status_code, 200)
            self.assertEqual(empty.get('/api/resumes/latest').status_code, 401)
        with get_connection() as connection:
            connection.execute('UPDATE user_sessions SET expires_at = CURRENT_TIMESTAMP WHERE token_hash = %s',
                               (hash_token(tokens[0]),))
        with TestClient(app) as expired:
            expired.cookies.set('interview_session', tokens[0])
            self.assertEqual(expired.get('/api/resumes/latest').status_code, 401)
