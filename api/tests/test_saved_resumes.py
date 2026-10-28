from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4

import psycopg
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.main import app


class SavedResumeTests(TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_no_session_cannot_read_saved_resume(self):
        with patch('app.resumes.get_connection') as connection:
            response = self.client.get('/api/resumes/latest')
            self.assertEqual(response.status_code, 401)
            connection.assert_not_called()

    def test_invalid_session_cannot_read_saved_resume(self):
        self.client.cookies.set('interview_session', 'invalid-session')
        with patch('app.auth.get_connection') as auth_connection:
            auth_connection.return_value.__enter__.return_value.execute.return_value.fetchone.return_value = None
            with patch('app.resumes.get_connection') as resume_connection:
                self.assertEqual(self.client.get('/api/resumes/latest').status_code, 401)
                resume_connection.assert_not_called()

    def test_no_linked_resume_returns_empty_result_without_caching(self):
        app.dependency_overrides[get_current_user] = lambda: {'id': str(uuid4())}
        with patch('app.resumes.get_connection') as connection:
            connection.return_value.__enter__.return_value.execute.return_value.fetchone.return_value = None
            response = self.client.get('/api/resumes/latest')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'resume': None})
        self.assertEqual(response.headers['cache-control'], 'no-store')

    def test_storage_failure_does_not_expose_connection_details(self):
        app.dependency_overrides[get_current_user] = lambda: {'id': str(uuid4())}
        with patch('app.resumes.get_connection', side_effect=psycopg.OperationalError('private-db-password')):
            response = self.client.get('/api/resumes/latest')
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private-db-password', response.text)
