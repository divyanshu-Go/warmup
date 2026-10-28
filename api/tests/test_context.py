from unittest import TestCase
from unittest.mock import Mock, patch
from uuid import uuid4

from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.main import app
from app.rag import retrieve_context, split_resume


class ResumeContextTests(TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.user_id = str(uuid4())
        self.resume_id = uuid4()
        self.path = f'/api/resumes/{self.resume_id}/context'

    def tearDown(self):
        app.dependency_overrides.clear()

    def signed_in(self):
        app.dependency_overrides[get_current_user] = lambda: {'id': self.user_id}

    def test_chunks_are_bounded_and_overlap(self):
        text = ''.join(str(i % 10) for i in range(1100))
        chunks = split_resume(text)
        self.assertEqual([len(chunk) for chunk in chunks], [500, 500, 200])
        self.assertEqual(chunks[0][-50:], chunks[1][:50])
        self.assertEqual(split_resume(' \n '), [])

    def test_sign_in_required_before_accessing_resume_or_vectors(self):
        with patch('app.resumes.get_connection') as connection, patch('app.resumes.retrieve_context') as retrieve:
            self.assertEqual(self.client.post(self.path, json={'query': 'Python'}).status_code, 401)
            connection.assert_not_called()
            retrieve.assert_not_called()

    def test_unowned_resume_is_rejected_before_vector_access(self):
        self.signed_in()
        with patch('app.resumes.get_connection') as connection, patch('app.resumes.retrieve_context') as retrieve:
            connection.return_value.__enter__.return_value.execute.return_value.fetchone.return_value = None
            self.assertEqual(self.client.post(self.path, json={'query': 'Python'}).status_code, 404)
            retrieve.assert_not_called()

    def test_invalid_query_does_not_access_vectors(self):
        self.signed_in()
        with patch('app.resumes.retrieve_context') as retrieve:
            for query, status in [('', 422), ('  ', 400), ('x' * 501, 422)]:
                self.assertEqual(self.client.post(self.path, json={'query': query}).status_code, status)
            retrieve.assert_not_called()

    def test_vector_failure_does_not_expose_document_or_local_details(self):
        self.signed_in()
        with patch('app.resumes.get_connection') as connection:
            connection.return_value.__enter__.return_value.execute.return_value.fetchone.return_value = ('Private resume text',)
            with patch('app.resumes.retrieve_context', side_effect=RuntimeError('Private resume text')):
                response = self.client.post(self.path, json={'query': 'Python'})
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('Private resume text', response.text)

    def test_retry_reuses_ids_and_always_filters_user_and_resume(self):
        collection = Mock()
        expected_id = f'{self.user_id}:{self.resume_id}:0'
        collection.get.side_effect = [{'ids': []}, {'ids': [expected_id]}]
        collection.query.return_value = {'documents': [['Python work']], 'metadatas': [[{'chunk': 0}]]}
        with patch('app.rag.get_collection', return_value=collection):
            first = retrieve_context(self.user_id, self.resume_id, 'Python work', 'Python')
            second = retrieve_context(self.user_id, self.resume_id, 'Python work', 'Python')
        self.assertEqual(first, second)
        collection.upsert.assert_called_once()
        self.assertEqual(collection.query.call_args.kwargs['where'], {
            '$and': [{'user_id': self.user_id}, {'resume_id': str(self.resume_id)}],
        })
