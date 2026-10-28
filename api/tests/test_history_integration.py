"""Opt-in read-only history API checks with synthetic Neon fixtures."""
import os
from datetime import datetime, timedelta, timezone
from unittest import TestCase, skipUnless
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from app.auth import hash_token
from app.db import get_connection
from app.main import app


@skipUnless(os.getenv('RUN_DB_TESTS') == '1', 'Set RUN_DB_TESTS=1 for history ownership tests')
class HistoryDatabaseTests(TestCase):
    def test_history_is_completed_ordered_paginated_and_owned(self):
        owner, other, old_resume, new_resume, foreign_resume = [uuid4() for _ in range(5)]
        token, other_token = uuid4().hex + uuid4().hex, uuid4().hex + uuid4().hex
        now = datetime.now(timezone.utc)
        ids = {}
        with get_connection() as connection:
            for user_id, session in [(owner, token), (other, other_token)]:
                connection.execute('INSERT INTO app_users (id, email, name) VALUES (%s, %s, %s)',
                                   (user_id, f'history-test-{user_id.hex}@example.com', 'History Test'))
                connection.execute("INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES (%s, %s, CURRENT_TIMESTAMP + INTERVAL '1 hour')", (hash_token(session), user_id))
            for resume_id, user_id, filename in [(old_resume, owner, 'old-history-test.pdf'), (new_resume, owner, 'new-history-test.pdf'), (foreign_resume, other, 'foreign-history-test.pdf')]:
                connection.execute('INSERT INTO resume_uploads (id, filename, raw_text, parsed_data, user_id) VALUES (%s, %s, %s, %s, %s)',
                                   (resume_id, filename, 'Synthetic history fixture', Jsonb({'skills': ['Python']}), user_id))
            cases = [('latest', owner, new_resume, 0, 0), ('middle', owner, old_resume, 1, 7),
                     ('oldest', owner, new_resume, 2, 8), ('foreign', other, foreign_resume, -1, 10),
                     ('mismatched_owner', owner, foreign_resume, -2, 10)]
            for name, user_id, resume_id, days, score in cases:
                turn_id = uuid4()
                ids[name] = str(turn_id)
                connection.execute(
                    """INSERT INTO interview_turns (id, user_id, resume_id, kind, difficulty, question, answer, score, feedback, answered_at)
                       VALUES (%s, %s, %s, 'technical', 'Easy', %s, %s, %s, %s, %s)""",
                    (turn_id, user_id, resume_id, name + ' question', name + ' answer', score, name + ' feedback', now - timedelta(days=days)),
                )
            connection.execute("INSERT INTO interview_turns (id, user_id, resume_id, kind, difficulty, question) VALUES (%s, %s, %s, 'hr', 'Easy', 'Pending question')", (uuid4(), owner, new_resume))

        with TestClient(app) as api, patch('app.interviews.ask_interview_llm', side_effect=AssertionError('History must not call AI')):
            self.assertEqual(api.get('/api/interview/history').status_code, 401)
            api.cookies.set('interview_session', token)
            first = api.get('/api/interview/history?limit=2')
            self.assertEqual(first.status_code, 200)
            self.assertEqual(first.headers['cache-control'], 'no-store')
            entries = first.json()['entries']
            self.assertEqual([entry['id'] for entry in entries], [ids['latest'], ids['middle']])
            self.assertEqual(entries[0]['score'], 0)
            self.assertEqual(entries[1]['filename'], 'old-history-test.pdf')
            self.assertEqual(entries[0]['answer'], 'latest answer')
            self.assertTrue(first.json()['has_more'])
            page = api.get('/api/interview/history?limit=2&offset=2').json()
            self.assertEqual([entry['id'] for entry in page['entries']], [ids['oldest']])
            self.assertFalse(page['has_more'])
            self.assertEqual(api.get('/api/interview/history?offset=100').json(), {'entries': [], 'has_more': False})
            spoofed = api.get(f'/api/interview/history?user_id={other}').json()['entries']
            self.assertEqual(len(spoofed), 3)
            self.assertNotIn(ids['foreign'], [entry['id'] for entry in spoofed])
            self.assertNotIn(ids['mismatched_owner'], [entry['id'] for entry in spoofed])
            self.assertEqual(api.post('/api/auth/logout').status_code, 200)
            self.assertEqual(api.get('/api/interview/history').status_code, 401)
        with TestClient(app) as api:
            api.cookies.set('interview_session', other_token)
            self.assertEqual([entry['id'] for entry in api.get('/api/interview/history').json()['entries']], [ids['foreign']])
