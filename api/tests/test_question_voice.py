from io import BytesIO
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4
import wave

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.main import app
from app.speech import speech_chunks, synthesize_question


def question_wav(rate=24000):
    output = BytesIO()
    with wave.open(output, 'wb') as writer:
        writer.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
        writer.writeframes(b'\x10\x00' * 2400)
    return output.getvalue()


class QuestionVoiceTests(TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.path = f'/api/interview/{uuid4()}/speech'

    def tearDown(self):
        app.dependency_overrides.clear()

    def signed_in(self):
        app.dependency_overrides[get_current_user] = lambda: {'id': str(uuid4())}

    def test_long_question_is_split_without_losing_words(self):
        text = 'Explain your design choices and how you tested the project. ' * 9
        chunks = speech_chunks(text)
        self.assertTrue(all(0 < len(chunk) <= 200 for chunk in chunks))
        self.assertEqual(' '.join(chunks), ' '.join(text.split()))
        self.assertEqual(speech_chunks('x' * 200), ['x' * 200])
        self.assertEqual(''.join(speech_chunks('x' * 401)), 'x' * 401)

    def test_orpheus_autumn_is_used_and_wav_frames_are_joined(self):
        text = 'Explain your project and describe your design decisions. ' * 6
        chunks = speech_chunks(text)
        with patch('app.speech.get_groq_client') as client:
            create = client.return_value.__enter__.return_value.audio.speech.create
            create.return_value.read.return_value = question_wav()
            result = synthesize_question(text)
            self.assertEqual(create.call_count, len(chunks))
            for call in create.call_args_list:
                self.assertEqual(call.kwargs['model'], 'canopylabs/orpheus-v1-english')
                self.assertEqual(call.kwargs['voice'], 'autumn')
                self.assertEqual(call.kwargs['response_format'], 'wav')
                self.assertLessEqual(len(call.kwargs['input']), 200)
        with wave.open(BytesIO(result), 'rb') as audio:
            self.assertEqual(audio.getnframes(), 2400 * len(chunks))
            self.assertEqual(audio.getframerate(), 24000)

    def test_unreadable_or_inconsistent_audio_is_not_returned(self):
        for segments in [[b'not WAV'], [question_wav(), question_wav(rate=16000)]]:
            with self.subTest(segments=len(segments)), patch('app.speech.get_groq_client') as client:
                client.return_value.__enter__.return_value.audio.speech.create.return_value.read.side_effect = segments
                text = 'Question' if len(segments) == 1 else 'Explain the project. ' * 15
                with self.assertRaises(HTTPException) as error:
                    synthesize_question(text)
                self.assertEqual(error.exception.status_code, 502)

    def test_signed_out_request_never_generates_speech(self):
        with patch('app.interviews.synthesize_question') as speech:
            self.assertEqual(self.client.post(self.path).status_code, 401)
            speech.assert_not_called()

    def test_foreign_question_is_not_read_or_sent_to_provider(self):
        self.signed_in()
        with patch('app.interviews.get_connection') as connection, patch('app.interviews.synthesize_question') as speech:
            connection.return_value.__enter__.return_value.execute.return_value.fetchone.return_value = None
            self.assertEqual(self.client.post(self.path).status_code, 404)
            speech.assert_not_called()

    def test_only_stored_question_is_spoken_and_audio_is_private(self):
        self.signed_in()
        audio = question_wav()
        with patch('app.interviews.get_connection') as connection, patch('app.interviews.synthesize_question', return_value=audio) as speech:
            connection.return_value.__enter__.return_value.execute.return_value.fetchone.return_value = ('Explain your project.',)
            response = self.client.post(self.path, json={'input': 'Client injected speech'})
            speech.assert_called_once_with('Explain your project.')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, audio)
        self.assertEqual(response.headers['content-type'], 'audio/wav')
        self.assertEqual(response.headers['cache-control'], 'no-store')
