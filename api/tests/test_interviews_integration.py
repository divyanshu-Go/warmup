"""Opt-in Neon interview lifecycle with deterministic AI/context stubs."""
import os
from unittest import TestCase, skipUnless
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from app.auth import hash_token
from app.db import get_connection
from app.interviews import Evaluation, GeneratedQuestion
from app.main import app
from app.setup_db import setup_database


@skipUnless(os.getenv('RUN_DB_TESTS') == '1', 'Set RUN_DB_TESTS=1 for Neon interview tests')
class InterviewDatabaseTests(TestCase):
    def test_combined_interview_is_owned_saved_and_retry_safe(self):
        setup_database()
        owner, other, resume, foreign, unlinked = [uuid4() for _ in range(5)]
        token, other_token = uuid4().hex + uuid4().hex, uuid4().hex + uuid4().hex
        with get_connection() as connection:
            for user_id, session in [(owner, token), (other, other_token)]:
                connection.execute('INSERT INTO app_users (id, email, name) VALUES (%s, %s, %s)',
                                   (user_id, f'interview-test-{user_id.hex}@example.com', 'Interview Test'))
                connection.execute("INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES (%s, %s, CURRENT_TIMESTAMP + INTERVAL '1 day')",
                                   (hash_token(session), user_id))
            for resume_id, user_id in [(resume, owner), (foreign, other), (unlinked, None)]:
                connection.execute('INSERT INTO resume_uploads (id, filename, raw_text, parsed_data, user_id) VALUES (%s, %s, %s, %s, %s)',
                                   (resume_id, 'interview-test.pdf', 'Python API project',
                                    Jsonb({'skills': ['Python'], 'difficulty_level': 'Easy'}), user_id))

        def question(api, resume_id=resume):
            return api.post('/api/interview/question', json={'resume_id': str(resume_id)})

        with TestClient(app) as api, patch('app.interviews.ask_interview_llm') as ai:
            with patch('app.interviews.retrieve_context', return_value={'matches': [{'text': 'Python API project'}]}):
                api.cookies.set('interview_session', token)
                self.assertEqual(question(api, foreign).status_code, 404)
                self.assertEqual(question(api, unlinked).status_code, 404)
                ai.assert_not_called()
                ai.return_value = GeneratedQuestion(question='How did you build your Python API?')
                first = question(api)
                self.assertEqual(first.status_code, 200)
                self.assertEqual(first.json()['kind'], 'technical')
                self.assertEqual(first.json()['difficulty'], 'Easy')
                turn_id = first.json()['id']
                self.assertEqual(question(api).json()['id'], turn_id)
                self.assertEqual(ai.call_count, 1)
                with TestClient(app) as other_api:
                    other_api.cookies.set('interview_session', other_token)
                    self.assertEqual(other_api.post(f'/api/interview/{turn_id}/answer', json={'answer': 'Other user'}).status_code, 404)

                ai.side_effect = HTTPException(502, 'Simulated AI failure')
                answer_path = f'/api/interview/{turn_id}/answer'
                self.assertEqual(api.post(answer_path, json={'answer': 'I used FastAPI.'}).status_code, 502)
                with get_connection() as connection:
                    self.assertIsNone(connection.execute('SELECT answer FROM interview_turns WHERE id = %s', (turn_id,)).fetchone()[0])
                ai.side_effect = None
                ai.return_value = Evaluation(score=7, feedback='Explain routing and add a concrete example.')
                result = api.post(answer_path, json={'answer': 'I used FastAPI.', 'question': 'Client-injected question', 'score': 10})
                self.assertEqual(result.status_code, 200)
                self.assertEqual(result.json()['score'], 7)
                self.assertNotIn('Client-injected question', ai.call_args.args[0])
                calls = ai.call_count
                self.assertEqual(api.post(answer_path, json={'answer': 'I used FastAPI.'}).json(), result.json())
                self.assertEqual(api.post(answer_path, json={'answer': 'Changed answer'}).status_code, 409)
                self.assertEqual(ai.call_count, calls)
                with get_connection() as connection:
                    row = connection.execute('SELECT question, answer, score, feedback, answered_at FROM interview_turns WHERE id = %s', (turn_id,)).fetchone()
                    self.assertEqual(row[:4], ('How did you build your Python API?', 'I used FastAPI.', 7, result.json()['feedback']))
                    self.assertIsNotNone(row[4])
                ai.return_value = GeneratedQuestion(question='Tell me about a challenge on that project.')
                second = question(api)
                self.assertEqual(second.status_code, 200)
                self.assertEqual(second.json()['kind'], 'hr')
                self.assertNotEqual(second.json()['id'], turn_id)
                with get_connection() as connection:
                    self.assertEqual(connection.execute('SELECT COUNT(*) FROM interview_turns WHERE user_id = %s AND resume_id = %s AND answer IS NULL', (owner, resume)).fetchone()[0], 1)
