import os
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.interviews import Evaluation, ask_interview_llm
from app.main import app


class InterviewTests(TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.user_id = str(uuid4())
        self.resume_id = uuid4()
        self.turn_id = uuid4()

    def tearDown(self):
        app.dependency_overrides.clear()

    def signed_in(self):
        app.dependency_overrides[get_current_user] = lambda: {'id': self.user_id}

    def test_signed_out_requests_do_not_access_interviews(self):
        with patch('app.interviews.get_connection') as database:
            self.assertEqual(self.client.post('/api/interview/question', json={'resume_id': str(self.resume_id)}).status_code, 401)
            self.assertEqual(self.client.post(f'/api/interview/{self.turn_id}/answer', json={'answer': 'Test'}).status_code, 401)
            database.assert_not_called()

    def test_foreign_or_unlinked_resume_cannot_generate_question(self):
        self.signed_in()
        with patch('app.interviews.get_connection') as database, patch('app.interviews.ask_interview_llm') as ai:
            database.return_value.__enter__.return_value.execute.return_value.fetchone.return_value = None
            response = self.client.post('/api/interview/question', json={'resume_id': str(self.resume_id)})
            self.assertEqual(response.status_code, 404)
            ai.assert_not_called()

    def test_existing_pending_question_is_reused_without_ai(self):
        self.signed_in()
        with patch('app.interviews.get_connection') as database, patch('app.interviews.ask_interview_llm') as ai:
            database.return_value.__enter__.return_value.execute.return_value.fetchone.side_effect = [
                ('Resume', {'difficulty_level': 'Easy'}),
                (self.turn_id, self.resume_id, 'technical', 'Explain your project.', 'Easy'),
            ]
            response = self.client.post('/api/interview/question', json={'resume_id': str(self.resume_id)})
            self.assertEqual(response.json()['id'], str(self.turn_id))
            ai.assert_not_called()

    def test_blank_or_oversized_answer_is_rejected_before_ai(self):
        self.signed_in()
        with patch('app.interviews.ask_interview_llm') as ai:
            for answer in ['', '   ', 'x' * 10001]:
                response = self.client.post(f'/api/interview/{self.turn_id}/answer', json={'answer': answer})
                self.assertEqual(response.status_code, 422)
            ai.assert_not_called()

    def test_foreign_turn_cannot_be_evaluated(self):
        self.signed_in()
        with patch('app.interviews.get_connection') as database, patch('app.interviews.ask_interview_llm') as ai:
            database.return_value.__enter__.return_value.execute.return_value.fetchone.return_value = None
            response = self.client.post(f'/api/interview/{self.turn_id}/answer', json={'answer': 'Test'})
            self.assertEqual(response.status_code, 404)
            ai.assert_not_called()

    def test_repeated_answer_returns_saved_score_but_changed_answer_is_rejected(self):
        self.signed_in()
        with patch('app.interviews.get_connection') as database, patch('app.interviews.ask_interview_llm') as ai:
            database.return_value.__enter__.return_value.execute.return_value.fetchone.return_value = (
                'Stored question', 'technical', 'Easy', 'My saved answer', 7, 'Saved feedback',
            )
            first = self.client.post(f'/api/interview/{self.turn_id}/answer', json={'answer': 'My saved answer'})
            self.assertEqual(first.status_code, 200)
            self.assertEqual(first.json()['score'], 7)
            self.assertEqual(self.client.post(f'/api/interview/{self.turn_id}/answer', json={'answer': 'Changed'}).status_code, 409)
            ai.assert_not_called()

    def test_invalid_ai_score_is_rejected_without_leaking_response(self):
        with patch.dict(os.environ, {'GROQ_API_KEY': 'test-key'}), patch('app.ai.Groq') as groq:
            completion = groq.return_value.__enter__.return_value.chat.completions.create.return_value
            completion.choices[0].message.content = '{"score": 99, "feedback": "private-response"}'
            with self.assertRaises(HTTPException) as error:
                ask_interview_llm('prompt', Evaluation, 0.2)
            self.assertEqual(error.exception.status_code, 502)
            self.assertNotIn('private-response', error.exception.detail)
