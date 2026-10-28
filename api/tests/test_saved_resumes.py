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

    def test_list_and_detail_require_authentication(self):
        with patch('app.resumes.get_connection') as connection:
            self.assertEqual(self.client.get('/api/resumes').status_code, 401)
            self.assertEqual(self.client.get(f'/api/resumes/{uuid4()}').status_code, 401)
            connection.assert_not_called()

    def test_list_is_paginated_owned_and_excludes_raw_text(self):
        owner, first, second = uuid4(), uuid4(), uuid4()
        app.dependency_overrides[get_current_user] = lambda: {'id': str(owner)}
        with patch('app.resumes.get_connection') as connection:
            db = connection.return_value.__enter__.return_value
            db.execute.return_value.fetchall.return_value = [(first, 'first.pdf', '2026-10-28'), (second, 'second.pdf', '2026-10-27')]
            response = self.client.get('/api/resumes?limit=1&offset=2')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(db.execute.call_args.args[1], (owner, 2, 2))
            self.assertEqual(response.json()['resumes'][0]['id'], str(first))
            self.assertEqual(len(response.json()['resumes']), 1)
            self.assertTrue(response.json()['has_more'])
            self.assertEqual(response.headers['cache-control'], 'no-store')
            self.assertNotIn('raw_text', response.text)

    def test_detail_queries_both_owner_and_resume_and_hides_foreign_records(self):
        owner, resume = uuid4(), uuid4()
        app.dependency_overrides[get_current_user] = lambda: {'id': str(owner)}
        with patch('app.resumes.get_connection') as connection:
            db = connection.return_value.__enter__.return_value
            db.execute.return_value.fetchone.return_value = None
            self.assertEqual(self.client.get(f'/api/resumes/{resume}').status_code, 404)
            self.assertEqual(db.execute.call_args.args[1], (resume, owner))
            db.execute.return_value.fetchone.return_value = (resume, 'own.pdf', {'skills': []}, '2026-10-28')
            response = self.client.get(f'/api/resumes/{resume}')
            self.assertEqual(response.json()['resume']['id'], str(resume))
            self.assertEqual(response.headers['cache-control'], 'no-store')

    def test_invalid_list_pagination_is_rejected(self):
        app.dependency_overrides[get_current_user] = lambda: {'id': str(uuid4())}
        with patch('app.resumes.get_connection') as connection:
            for query in ['limit=0', 'limit=51', 'offset=-1']:
                self.assertEqual(self.client.get('/api/resumes?' + query).status_code, 422)
            connection.assert_not_called()
