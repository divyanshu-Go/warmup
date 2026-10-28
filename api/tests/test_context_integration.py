"""Opt-in real local embeddings/Chroma plus Neon authorization. No email or Groq."""
import hashlib
import os
from pathlib import Path
from unittest import TestCase, skipUnless
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from app.auth import hash_token
from app.db import get_connection
from app.main import app


@skipUnless(os.getenv('RUN_CONTEXT_TESTS') == '1', 'Set RUN_CONTEXT_TESTS=1 for Chroma/Neon integration')
class ChromaContextIntegrationTests(TestCase):
    def test_owned_persistent_context_without_cross_user_or_cross_resume_results(self):
        import chromadb
        from chromadb.config import Settings
        from chromadb.utils.embedding_functions import ONNXMiniLM_L6_V2

        legacy_path = Path(__file__).resolve().parents[3] / 'chroma_db' / 'chroma.sqlite3'
        legacy_hash = hashlib.sha256(legacy_path.read_bytes()).hexdigest() if legacy_path.exists() else None
        path = Path(__file__).resolve().parent.parent / 'chroma_test_db'
        name = 'context-test-' + uuid4().hex
        settings = Settings(anonymized_telemetry=False)
        client = chromadb.PersistentClient(path=str(path), settings=settings)
        embedding = ONNXMiniLM_L6_V2()
        collection = client.get_or_create_collection(name, embedding_function=embedding, metadata={'hnsw:space': 'cosine'})

        owner, other = uuid4(), uuid4()
        owner_token, other_token = uuid4().hex + uuid4().hex, uuid4().hex + uuid4().hex
        current_resume, other_resume, old_resume, unlinked_resume = [uuid4() for _ in range(4)]
        own_text = ('OWNER_CURRENT_PROJECT: Built Python APIs with FastAPI and PostgreSQL. ' * 12)
        foreign_text = ('FOREIGN_PRIVATE_PROJECT: Built Python APIs with FastAPI and PostgreSQL. ' * 12)
        old_text = ('OWNER_OLD_PROJECT: Built Python APIs with FastAPI and PostgreSQL. ' * 12)
        with get_connection() as connection:
            for user_id, token in [(owner, owner_token), (other, other_token)]:
                connection.execute('INSERT INTO app_users (id, email, name) VALUES (%s, %s, %s)',
                                   (user_id, f'context-test-{user_id.hex}@example.com', 'Context Test'))
                connection.execute("INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES (%s, %s, CURRENT_TIMESTAMP + INTERVAL '1 day')",
                                   (hash_token(token), user_id))
            for resume_id, user_id, text in [(current_resume, owner, own_text), (other_resume, other, foreign_text),
                                              (old_resume, owner, old_text), (unlinked_resume, None, own_text)]:
                connection.execute('INSERT INTO resume_uploads (id, filename, raw_text, parsed_data, user_id) VALUES (%s, %s, %s, %s, %s)',
                                   (resume_id, 'context-test.pdf', text, Jsonb({'skills': ['Python']}), user_id))

        def search(api, resume_id, **extra):
            return api.post(f'/api/resumes/{resume_id}/context', json={'query': 'Python API projects', **extra})

        with patch('app.rag.get_collection', return_value=collection), TestClient(app) as api:
            self.assertEqual(search(api, current_resume).status_code, 401)
            api.cookies.set('interview_session', owner_token)
            self.assertEqual(search(api, other_resume).status_code, 404)
            self.assertEqual(search(api, unlinked_resume).status_code, 404)
            self.assertEqual(collection.count(), 0)
            first = search(api, current_resume)
            self.assertEqual(first.status_code, 200, first.text)
            self.assertTrue(first.json()['matches'])
            self.assertEqual(first.headers['cache-control'], 'no-store')
            self.assertEqual(search(api, old_resume).status_code, 200)
            with TestClient(app) as other_api:
                other_api.cookies.set('interview_session', other_token)
                self.assertEqual(search(other_api, other_resume).status_code, 200)
            count = collection.count()
            second = search(api, current_resume, user_id=str(other))
            self.assertEqual(second.status_code, 200)
            self.assertEqual(collection.count(), count)
            for match in second.json()['matches']:
                self.assertNotIn('FOREIGN_PRIVATE_PROJECT', match['text'])
                self.assertNotIn('OWNER_OLD_PROJECT', match['text'])

        reopened = chromadb.PersistentClient(path=str(path), settings=settings).get_collection(name, embedding_function=embedding)
        self.assertEqual(reopened.count(), count)
        scope = {'$and': [{'user_id': str(owner)}, {'resume_id': str(current_resume)}]}
        persisted = reopened.query(query_texts=['Python'], where=scope, n_results=1, include=['metadatas'])
        self.assertEqual(persisted['metadatas'][0][0]['resume_id'], str(current_resume))
        if legacy_hash:
            self.assertEqual(hashlib.sha256(legacy_path.read_bytes()).hexdigest(), legacy_hash)
