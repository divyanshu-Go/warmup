"""Opt-in Neon recording pipeline test; speech and grading providers are stubbed."""
import hashlib
import os
from unittest import TestCase, skipUnless
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from app.auth import hash_token
from app.db import get_connection
from app.interviews import Evaluation
from app.main import app
from app.setup_db import setup_database
from tests.test_speech import wav_recording


@skipUnless(os.getenv('RUN_DB_TESTS') == '1', 'Set RUN_DB_TESTS=1 for speech persistence tests')
class SpeechDatabaseTests(TestCase):
    def test_transcript_is_cached_and_audio_retry_does_not_duplicate_evaluation(self):
        setup_database()
        user_id, resume_id, turn_id = uuid4(), uuid4(), uuid4()
        token = uuid4().hex + uuid4().hex
        with get_connection() as connection:
            connection.execute('INSERT INTO app_users (id, email, name) VALUES (%s, %s, %s)',
                               (user_id, f'speech-test-{user_id.hex}@example.com', 'Speech Test'))
            connection.execute("INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES (%s, %s, CURRENT_TIMESTAMP + INTERVAL '1 hour')", (hash_token(token), user_id))
            connection.execute('INSERT INTO resume_uploads (id, filename, raw_text, parsed_data, user_id) VALUES (%s, %s, %s, %s, %s)',
                               (resume_id, 'speech-test.pdf', 'Python project', Jsonb({'skills': ['Python']}), user_id))
            connection.execute("INSERT INTO interview_turns (id, user_id, resume_id, kind, difficulty, question) VALUES (%s, %s, %s, 'technical', 'Easy', 'Explain your Python project.')", (turn_id, user_id, resume_id))
        content = wav_recording()
        path = f'/api/interview/{turn_id}/audio-answer'
        transcript = 'I built a Python API with FastAPI and PostgreSQL.'
        with TestClient(app) as client, patch('app.interviews.transcribe_recording') as speech, patch('app.interviews.ask_interview_llm') as ai:
            client.cookies.set('interview_session', token)
            speech.side_effect = HTTPException(502, 'Simulated transcription outage')
            self.assertEqual(client.post(path, files={'audio': ('answer.wav', content)}).status_code, 502)
            ai.assert_not_called()
            with get_connection() as connection:
                self.assertEqual(connection.execute('SELECT transcript, answer FROM interview_turns WHERE id = %s', (turn_id,)).fetchone(), (None, None))
            speech.side_effect = None
            speech.return_value = transcript
            ai.side_effect = HTTPException(502, 'Simulated grading outage')
            failed = client.post(path, files={'audio': ('answer.wav', content)})
            self.assertEqual(failed.status_code, 502)
            self.assertEqual(failed.json()['detail']['transcript'], transcript)
            with get_connection() as connection:
                row = connection.execute('SELECT transcript, audio_sha256, answer FROM interview_turns WHERE id = %s', (turn_id,)).fetchone()
                self.assertEqual(row, (transcript, hashlib.sha256(content).hexdigest(), None))

            speech.reset_mock()
            speech.side_effect = AssertionError('Cached recording must not be transcribed again')
            ai.side_effect = None
            ai.return_value = Evaluation(score=8, feedback='Give a concrete example of your design decisions.')
            success = client.post(path, files={'audio': ('answer.wav', content)})
            self.assertEqual(success.status_code, 200)
            self.assertEqual(success.json()['answer'], transcript)
            self.assertEqual(success.json()['score'], 8)
            speech.assert_not_called()
            ai.reset_mock()
            repeat = client.post(path, files={'audio': ('answer.wav', content)})
            self.assertEqual(repeat.json(), success.json())
            ai.assert_not_called()
            self.assertEqual(client.post(path, files={'audio': ('answer.wav', content + b'changed')}).status_code, 409)
            with get_connection() as connection:
                row = connection.execute('SELECT transcript, answer, score, feedback, answered_at FROM interview_turns WHERE id = %s', (turn_id,)).fetchone()
                self.assertEqual(row[:4], (transcript, transcript, 8, success.json()['feedback']))
                self.assertIsNotNone(row[4])
