from io import BytesIO
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4
import hashlib
import wave

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.main import app
from app.speech import MAX_AUDIO_BYTES, recording_filename, transcribe_recording


def wav_recording():
    output = BytesIO()
    with wave.open(output, 'wb') as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(16000)
        writer.writeframes(b'\0\0' * 16000)
    return output.getvalue()


class SpeechTests(TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.turn_id = uuid4()
        self.path = f'/api/interview/{self.turn_id}/audio-answer'

    def tearDown(self):
        app.dependency_overrides.clear()

    def signed_in(self):
        app.dependency_overrides[get_current_user] = lambda: {'id': str(uuid4())}

    def test_container_signature_is_used_instead_of_client_filename(self):
        self.assertEqual(recording_filename(wav_recording()), 'answer.wav')
        self.assertEqual(recording_filename(b'\x1a\x45\xdf\xa3sample'), 'answer.webm')
        self.assertEqual(recording_filename(b'OggSsample'), 'answer.ogg')
        self.assertEqual(recording_filename(b'1234ftypsample'), 'answer.mp4')
        with self.assertRaises(HTTPException):
            recording_filename(b'not audio')

    def test_whisper_uses_verbose_json_temperature_zero_and_english(self):
        with patch('app.speech.get_groq_client') as groq:
            create = groq.return_value.__enter__.return_value.audio.transcriptions.create
            create.return_value = SimpleNamespace(text=' I built an API. ', duration=2, segments=[])
            self.assertEqual(transcribe_recording(wav_recording(), 'answer.wav'), 'I built an API.')
            self.assertEqual(create.call_args.kwargs['model'], 'whisper-large-v3-turbo')
            self.assertEqual(create.call_args.kwargs['response_format'], 'verbose_json')
            self.assertEqual(create.call_args.kwargs['temperature'], 0)
            self.assertEqual(create.call_args.kwargs['language'], 'en')

    def test_empty_silent_and_overlong_transcriptions_are_rejected(self):
        cases = [
            SimpleNamespace(text=' ', duration=2, segments=[]),
            SimpleNamespace(text='Noise hallucination', duration=2, segments=[{'no_speech_prob': .99, 'avg_logprob': -2}]),
            SimpleNamespace(text='Speech', duration=301, segments=[]),
            SimpleNamespace(text='x' * 10001, duration=200, segments=[]),
        ]
        for result in cases:
            with self.subTest(result=result), patch('app.speech.get_groq_client') as groq:
                groq.return_value.__enter__.return_value.audio.transcriptions.create.return_value = result
                with self.assertRaises(HTTPException) as error:
                    transcribe_recording(wav_recording(), 'answer.wav')
                self.assertEqual(error.exception.status_code, 400)

    def test_signed_out_upload_never_calls_speech_provider(self):
        with patch('app.interviews.transcribe_recording') as transcribe:
            response = self.client.post(self.path, files={'audio': ('answer.wav', wav_recording())})
            self.assertEqual(response.status_code, 401)
            transcribe.assert_not_called()

    def test_foreign_question_is_rejected_before_transcription(self):
        self.signed_in()
        with patch('app.interviews.get_connection') as database, patch('app.interviews.transcribe_recording') as transcribe:
            database.return_value.__enter__.return_value.execute.return_value.fetchone.return_value = None
            response = self.client.post(self.path, files={'audio': ('answer.wav', wav_recording())})
            self.assertEqual(response.status_code, 404)
            transcribe.assert_not_called()

    def test_invalid_recordings_do_not_call_provider(self):
        self.signed_in()
        with patch('app.interviews.get_connection') as database, patch('app.interviews.transcribe_recording') as transcribe:
            database.return_value.__enter__.return_value.execute.return_value.fetchone.return_value = (None, None, None, None, None)
            for data, status in [(b'', 400), (b'not audio', 415), (b'x' * (MAX_AUDIO_BYTES + 1), 413)]:
                response = self.client.post(self.path, files={'audio': ('spoofed.wav', data)})
                self.assertEqual(response.status_code, status)
            transcribe.assert_not_called()

    def test_completed_recording_retry_returns_saved_result_without_provider_calls(self):
        self.signed_in()
        content = wav_recording()
        digest = hashlib.sha256(content).hexdigest()
        with patch('app.interviews.get_connection') as database, patch('app.interviews.transcribe_recording') as transcribe:
            database.return_value.__enter__.return_value.execute.return_value.fetchone.return_value = ('Saved transcript', 7, 'Feedback', digest, 'Saved transcript')
            response = self.client.post(self.path, files={'audio': ('answer.wav', content)})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['answer'], 'Saved transcript')
            transcribe.assert_not_called()
            changed = self.client.post(self.path, files={'audio': ('answer.wav', content + b'new')})
            self.assertEqual(changed.status_code, 409)
