import os
import smtplib
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app
from app.mail import send_verification_email


class EmailVerificationTests(TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.smtp_settings = {
            'SMTP_HOST': 'smtp.example.com', 'SMTP_PORT': '587',
            'SMTP_USERNAME': 'test-user', 'SMTP_PASSWORD': 'test-secret',
            'SMTP_FROM': 'sender@example.com',
        }

    def test_missing_email_configuration_does_not_connect(self):
        with patch.dict(os.environ, {'SMTP_HOST': ''}), patch('app.mail.smtplib.SMTP') as smtp:
            with self.assertRaises(HTTPException) as error:
                send_verification_email('recipient@example.com', '123456')
            self.assertEqual(error.exception.status_code, 503)
            smtp.assert_not_called()

    def test_smtp_uses_starttls_and_correct_recipient(self):
        with patch.dict(os.environ, self.smtp_settings), patch('app.mail.smtplib.SMTP') as smtp:
            send_verification_email('recipient@example.com', '123456')
            connection = smtp.return_value.__enter__.return_value
            connection.starttls.assert_called_once()
            connection.login.assert_called_once_with('test-user', 'test-secret')
            message = connection.send_message.call_args.args[0]
            self.assertEqual(message['To'], 'recipient@example.com')
            self.assertIn('123456', message.get_content())

    def test_port_465_uses_ssl(self):
        with patch.dict(os.environ, {**self.smtp_settings, 'SMTP_PORT': '465'}):
            with patch('app.mail.smtplib.SMTP_SSL') as smtp:
                send_verification_email('recipient@example.com', '123456')
                smtp.return_value.__enter__.return_value.starttls.assert_not_called()

    def test_delivery_errors_do_not_expose_credentials(self):
        with patch.dict(os.environ, self.smtp_settings):
            with patch('app.mail.smtplib.SMTP', side_effect=smtplib.SMTPException('test-secret')):
                with self.assertRaises(HTTPException) as error:
                    send_verification_email('recipient@example.com', '123456')
                self.assertNotIn('test-secret', error.exception.detail)

    def test_untrusted_origin_is_rejected_before_database_access(self):
        with patch('app.auth.get_connection') as database:
            response = self.client.post('/api/auth/send-code', json={'resume_id': str(uuid4())},
                                        headers={'Origin': 'https://untrusted.example'})
            self.assertEqual(response.status_code, 403)
            database.assert_not_called()

    def test_malformed_code_is_rejected_before_verification(self):
        with patch('app.auth.verify_and_create_session') as verify:
            response = self.client.post('/api/auth/verify-code', json={'resume_id': str(uuid4()), 'code': '123'})
            self.assertEqual(response.status_code, 422)
            verify.assert_not_called()

    def test_session_token_is_only_in_http_only_cookie(self):
        user = {'id': str(uuid4()), 'email': 'test@example.com', 'name': 'Test'}
        with patch('app.auth.verify_and_create_session', return_value=(user, 'private-session-token')):
            response = self.client.post('/api/auth/verify-code', json={'resume_id': str(uuid4()), 'code': '123456'})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('private-session-token', response.text)
        self.assertIn('HttpOnly', response.headers['set-cookie'])
        self.assertIn('SameSite=lax', response.headers['set-cookie'])

    def test_no_cookie_is_not_authenticated(self):
        self.assertEqual(self.client.get('/api/auth/me').status_code, 401)
