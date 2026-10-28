from io import BytesIO
from unittest import TestCase
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject

from app.main import app
from app.resumes import MAX_FILE_SIZE


def sample_pdf():
    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
    font = DictionaryObject({
        NameObject('/Type'): NameObject('/Font'),
        NameObject('/Subtype'): NameObject('/Type1'),
        NameObject('/BaseFont'): NameObject('/Helvetica'),
    })
    page[NameObject('/Resources')] = DictionaryObject({
        NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)}),
    })
    stream = DecodedStreamObject()
    stream.set_data(b'''BT /F1 12 Tf 50 740 Td
(Migration Test Candidate) Tj 0 -20 Td
(Email: resume-test@example.com) Tj 0 -20 Td
(Skills: Python, SQL, FastAPI) Tj 0 -20 Td
(Experience: One year building Python APIs and PostgreSQL applications.) Tj 0 -20 Td
(Education: Bachelor of Computer Science, 2025.) Tj ET''')
    page[NameObject('/Contents')] = writer._add_object(stream)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


class ResumeUploadTests(TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_invalid_uploads_never_call_ai_or_database(self):
        with patch('app.resumes.parse_resume') as parse, patch('app.resumes.save_resume') as save:
            cases = [
                ('resume.txt', b'not a PDF', 400),
                ('resume.pdf', b'', 400),
                ('resume.pdf', b'broken PDF', 400),
                ('resume.pdf', b'x' * (MAX_FILE_SIZE + 1), 413),
            ]
            for name, content, status in cases:
                with self.subTest(name=name, size=len(content)):
                    response = self.client.post('/api/resumes', files={'file': (name, content)})
                    self.assertEqual(response.status_code, status)
            parse.assert_not_called()
            save.assert_not_called()

    def test_scanned_or_blank_pdf_is_rejected(self):
        writer = PdfWriter()
        writer.add_blank_page(width=612, height=792)
        output = BytesIO()
        writer.write(output)
        response = self.client.post('/api/resumes', files={'file': ('blank.pdf', output.getvalue())})
        self.assertEqual(response.status_code, 400)
        self.assertIn('No readable text', response.json()['detail'])

    def test_password_protected_pdf_is_rejected(self):
        writer = PdfWriter()
        writer.add_blank_page(width=612, height=792)
        writer.encrypt('test-password')
        output = BytesIO()
        writer.write(output)
        response = self.client.post('/api/resumes', files={'file': ('locked.pdf', output.getvalue())})
        self.assertEqual(response.status_code, 400)
        self.assertIn('password protection', response.json()['detail'])

    def test_parse_failure_does_not_save_a_record(self):
        with patch('app.resumes.parse_resume', side_effect=HTTPException(502, 'Parsing failed')):
            with patch('app.resumes.save_resume') as save:
                response = self.client.post('/api/resumes', files={'file': ('resume.pdf', sample_pdf())})
                self.assertEqual(response.status_code, 502)
                save.assert_not_called()

    def test_extracted_text_and_details_are_passed_to_storage(self):
        details = {'name': 'Migration Test Candidate', 'skills': ['Python']}
        with patch('app.resumes.parse_resume', return_value=details) as parse:
            with patch('app.resumes.save_resume', return_value={'id': 'test-reference'}) as save:
                response = self.client.post('/api/resumes', files={'file': ('resume.PDF', sample_pdf())})
                self.assertEqual(response.status_code, 201)
                text = parse.call_args.args[0]
                self.assertIn('resume-test@example.com', text)
                self.assertIn('Python', text)
                save.assert_called_once_with('resume.PDF', text, details)
