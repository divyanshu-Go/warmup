"""Opt-in Neon test. Creates synthetic records and intercepts SMTP delivery."""
import os
from unittest import TestCase, skipUnless
from unittest.mock import patch
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from app.db import get_connection
from app.main import app
from app.setup_db import setup_database


@skipUnless(os.getenv('RUN_DB_TESTS') == '1', 'Set RUN_DB_TESTS=1 to test against Neon')
class VerificationDatabaseTests(TestCase):
    def test_verification_and_session_lifecycle(self):
        setup_database()
        email = f'auth-test-{uuid4().hex}@example.com'
        first_resume, second_resume = uuid4(), uuid4()
        details = {'email': email, 'name': 'Verification Test'}
        with get_connection() as connection:
            for resume_id in [first_resume, second_resume]:
                connection.execute(
                    'INSERT INTO resume_uploads (id, filename, raw_text, parsed_data) VALUES (%s, %s, %s, %s)',
                    (resume_id, 'verification-test.pdf', 'Synthetic verification test', Jsonb(details)),
                )

        def post(client, path, resume_id, **extra):
            return client.post('/api/auth/' + path, json={'resume_id': str(resume_id), **extra})

        with TestClient(app) as client, patch('app.auth.send_verification_email') as mail:
            # Failed delivery must not create an active challenge or user.
            from fastapi import HTTPException
            mail.side_effect = HTTPException(503, 'Simulated delivery failure')
            self.assertEqual(post(client, 'send-code', first_resume).status_code, 503)
            with get_connection() as connection:
                self.assertIsNone(connection.execute('SELECT email FROM email_verifications WHERE email = %s', (email,)).fetchone())
                self.assertIsNone(connection.execute('SELECT id FROM app_users WHERE email = %s', (email,)).fetchone())
            mail.side_effect = None

            sent = post(client, 'send-code', first_resume)
            self.assertEqual(sent.status_code, 200)
            code = mail.call_args.args[1]
            self.assertNotIn(code, sent.text)
            self.assertEqual(post(client, 'send-code', first_resume).status_code, 429)
            self.assertEqual(post(client, 'verify-code', second_resume, code=code).status_code, 400)

            # Five wrong attempts persist across requests and block even a correct code.
            wrong = '000001' if code == '000000' else '000000'
            for _ in range(5):
                self.assertEqual(post(client, 'verify-code', first_resume, code=wrong).status_code, 400)
            self.assertEqual(post(client, 'verify-code', first_resume, code=code).status_code, 400)
            with get_connection() as connection:
                row = connection.execute('SELECT attempts, code_hash FROM email_verifications WHERE email = %s', (email,)).fetchone()
                self.assertEqual(row[0], 5)
                self.assertNotEqual(row[1], code)
                connection.execute("UPDATE email_verifications SET sent_at = CURRENT_TIMESTAMP - INTERVAL '61 seconds' WHERE email = %s", (email,))

            self.assertEqual(post(client, 'send-code', first_resume).status_code, 200)
            code = mail.call_args.args[1]
            with get_connection() as connection:
                connection.execute("UPDATE email_verifications SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second', sent_at = CURRENT_TIMESTAMP - INTERVAL '61 seconds' WHERE email = %s", (email,))
            self.assertEqual(post(client, 'verify-code', first_resume, code=code).status_code, 400)

            self.assertEqual(post(client, 'send-code', first_resume).status_code, 200)
            code = mail.call_args.args[1]
            verified = post(client, 'verify-code', first_resume, code=code)
            self.assertEqual(verified.status_code, 200)
            user_id = verified.json()['user']['id']
            self.assertEqual(client.get('/api/auth/me').json()['user']['id'], user_id)
            self.assertEqual(post(client, 'verify-code', first_resume, code=code).status_code, 400)
            session_cookie = client.cookies.get('interview_session')
            with get_connection() as connection:
                self.assertEqual(connection.execute('SELECT user_id FROM resume_uploads WHERE id = %s', (first_resume,)).fetchone()[0], UUID(user_id))
                connection.execute("UPDATE email_verifications SET sent_at = CURRENT_TIMESTAMP - INTERVAL '61 seconds' WHERE email = %s", (email,))

            # A second resume with the same verified email reuses the existing user.
            self.assertEqual(post(client, 'send-code', second_resume).status_code, 200)
            second = post(client, 'verify-code', second_resume, code=mail.call_args.args[1])
            self.assertEqual(second.status_code, 200)
            self.assertEqual(second.json()['user']['id'], user_id)
            with get_connection() as connection:
                self.assertEqual(connection.execute('SELECT COUNT(*) FROM app_users WHERE email = %s', (email,)).fetchone()[0], 1)
                self.assertEqual(connection.execute('SELECT user_id FROM resume_uploads WHERE id = %s', (second_resume,)).fetchone()[0], UUID(user_id))
            self.assertEqual(client.post('/api/auth/logout').status_code, 200)
            self.assertEqual(client.get('/api/auth/me').status_code, 401)

            # Expired sessions must not authenticate.
            client.cookies.set('interview_session', session_cookie)
            with get_connection() as connection:
                connection.execute('UPDATE user_sessions SET expires_at = CURRENT_TIMESTAMP WHERE user_id = %s', (UUID(user_id),))
            self.assertEqual(client.get('/api/auth/me').status_code, 401)
