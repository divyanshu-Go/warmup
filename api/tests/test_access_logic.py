"""Socket-free checks for the new auth and owned-resume logic; all storage is mocked."""
from unittest import TestCase
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException, Response
from pydantic import ValidationError

from app.auth import SignInRequest, SignInVerification, hash_code, hash_token, send_sign_in_code, verify_sign_in_code
from app.resumes import get_resume, list_resumes


class AccessLogicTests(TestCase):
    def test_unknown_and_cooldown_responses_match_without_sending_mail(self):
        with patch('app.auth.get_connection') as connect, patch('app.auth.send_verification_email') as mail:
            db = connect.return_value.__enter__.return_value
            db.execute.return_value.fetchone.side_effect = [None]
            unknown = send_sign_in_code(SignInRequest(email='someone@example.com'))
            db.execute.return_value.fetchone.side_effect = [(uuid4(),), None]
            cooldown = send_sign_in_code(SignInRequest(email='someone@example.com'))
            self.assertEqual(unknown, cooldown)
            mail.assert_not_called()

    def test_hashing_and_delivery_failure_leave_no_usable_challenge(self):
        with patch('app.auth.get_connection') as connect, patch('app.auth.send_verification_email') as mail:
            db = connect.return_value.__enter__.return_value
            db.execute.return_value.fetchone.side_effect = [(uuid4(),), ('someone@example.com',)]
            mail.side_effect = HTTPException(503, 'SMTP failed')
            result = send_sign_in_code(SignInRequest(email=' SOMEONE@EXAMPLE.COM '))
            code = mail.call_args.args[1]
            params = db.execute.call_args.args[1]
            self.assertEqual(params[0], 'someone@example.com')
            self.assertEqual(params[1], hash_code(code, params[2]))
            self.assertNotIn(code, result['message'])
            # The exception leaves the connection context before being caught,
            # so psycopg rolls back the challenge transaction.
            self.assertIs(connect.return_value.__exit__.call_args.args[0], HTTPException)

    def test_invalid_and_expired_codes_cannot_create_sessions(self):
        salt = 'ab' * 16
        user = uuid4()
        with patch('app.auth.get_connection') as connect:
            db = connect.return_value.__enter__.return_value
            for row in [None, (user, 'someone@example.com', '', hash_code('123456', salt), salt, 5, True),
                        (user, 'someone@example.com', '', hash_code('123456', salt), salt, 0, False)]:
                db.execute.reset_mock()
                db.execute.return_value.fetchone.return_value = row
                with self.assertRaises(HTTPException) as error:
                    verify_sign_in_code(SignInVerification(email='someone@example.com', code='123456'), Response())
                self.assertEqual(error.exception.status_code, 400)
                self.assertEqual(db.execute.call_count, 1)

    def test_wrong_code_updates_attempts_and_commits(self):
        salt = 'ab' * 16
        with patch('app.auth.get_connection') as connect:
            db = connect.return_value.__enter__.return_value
            db.execute.return_value.fetchone.return_value = (uuid4(), 'someone@example.com', '', hash_code('123456', salt), salt, 0, True)
            with self.assertRaises(HTTPException):
                verify_sign_in_code(SignInVerification(email='someone@example.com', code='654321'), Response())
            self.assertIn('attempts = attempts + 1', db.execute.call_args.args[0])
            self.assertIsNone(connect.return_value.__exit__.call_args.args[0])

    def test_success_consumes_only_sign_in_code_and_creates_hashed_session(self):
        salt, user = 'ab' * 16, uuid4()
        with patch('app.auth.get_connection') as connect, patch('app.auth.secrets.token_urlsafe', return_value='private-token'):
            db = connect.return_value.__enter__.return_value
            db.execute.return_value.fetchone.return_value = (user, 'someone@example.com', 'Test', hash_code('123456', salt), salt, 0, True)
            response = Response()
            result = verify_sign_in_code(SignInVerification(email='someone@example.com', code='123456'), response)
            self.assertEqual(result['user']['id'], str(user))
            self.assertIn('HttpOnly', response.headers['set-cookie'])
            self.assertIn('Max-Age=604800', response.headers['set-cookie'])
            self.assertEqual(db.execute.call_args.args[1], (hash_token('private-token'), user))
            sql = ' '.join(call.args[0] for call in db.execute.call_args_list)
            self.assertIn('FOR UPDATE OF v', sql)
            self.assertIn('attempts = 5', sql)
            self.assertNotIn('resume_uploads', sql)
            self.assertNotIn('INSERT INTO app_users', sql)

    def test_malformed_email_and_code_fail_validation(self):
        for values in [{'email': 'bad', 'code': '123456'}, {'email': 'a@example.com', 'code': '123'}]:
            with self.assertRaises(ValidationError):
                SignInVerification(**values)

    def test_resume_list_and_detail_scope_to_owner(self):
        owner, resume = uuid4(), uuid4()
        user = {'id': str(owner)}
        with patch('app.resumes.get_connection') as connect:
            db = connect.return_value.__enter__.return_value
            db.execute.return_value.fetchall.return_value = [(resume, 'own.pdf', '2026-10-28'), (uuid4(), 'older.pdf', '2026-10-27')]
            response = Response()
            result = list_resumes(response, offset=2, limit=1, user=user)
            self.assertTrue(result['has_more'])
            self.assertEqual(len(result['resumes']), 1)
            self.assertEqual(db.execute.call_args.args[1], (owner, 2, 2))
            self.assertEqual(response.headers['cache-control'], 'no-store')
            db.execute.return_value.fetchone.return_value = None
            with self.assertRaises(HTTPException) as error:
                get_resume(resume, Response(), user)
            self.assertEqual(error.exception.status_code, 404)
            self.assertEqual(db.execute.call_args.args[1], (resume, owner))
            db.execute.return_value.fetchone.return_value = (resume, 'own.pdf', {'skills': []}, '2026-10-28')
            self.assertEqual(get_resume(resume, Response(), user)['resume']['id'], str(resume))
