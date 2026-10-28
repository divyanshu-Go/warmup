from datetime import datetime, timezone
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4

import psycopg
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.main import app


class HistoryTests(TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def signed_in(self):
        app.dependency_overrides[get_current_user] = lambda: {'id': str(uuid4())}

    def test_signed_out_user_cannot_read_history(self):
        with patch('app.interviews.get_connection') as connection:
            self.assertEqual(self.client.get('/api/interview/history').status_code, 401)
            connection.assert_not_called()

    def test_empty_history_is_private_and_has_no_more_pages(self):
        self.signed_in()
        with patch('app.interviews.get_connection') as connection:
            connection.return_value.__enter__.return_value.execute.return_value.fetchall.return_value = []
            response = self.client.get('/api/interview/history')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'entries': [], 'has_more': False})
        self.assertEqual(response.headers['cache-control'], 'no-store')

    def test_invalid_pagination_is_rejected(self):
        self.signed_in()
        with patch('app.interviews.get_connection') as connection:
            for query in ['limit=0', 'limit=51', 'offset=-1', 'offset=invalid']:
                self.assertEqual(self.client.get('/api/interview/history?' + query).status_code, 422)
            connection.assert_not_called()

    def test_zero_score_and_full_answer_are_preserved_with_pagination(self):
        self.signed_in()
        now = datetime.now(timezone.utc)
        rows = [(uuid4(), uuid4(), 'resume.pdf', 'technical', 'Easy', 'Question?', 'Full saved answer', 0, 'Feedback', now, now)
                for _ in range(3)]
        with patch('app.interviews.get_connection') as connection:
            connection.return_value.__enter__.return_value.execute.return_value.fetchall.return_value = rows
            response = self.client.get('/api/interview/history?limit=2')
        self.assertEqual(len(response.json()['entries']), 2)
        self.assertTrue(response.json()['has_more'])
        self.assertEqual(response.json()['entries'][0]['score'], 0)
        self.assertEqual(response.json()['entries'][0]['answer'], 'Full saved answer')
        self.assertNotIn('audio_sha256', response.text)

    def test_storage_errors_do_not_expose_private_details(self):
        self.signed_in()
        with patch('app.interviews.get_connection', side_effect=psycopg.OperationalError('private-password')):
            response = self.client.get('/api/interview/history')
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private-password', response.text)
