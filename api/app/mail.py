import os
import smtplib
import ssl
from email.message import EmailMessage

from fastapi import HTTPException


def send_verification_email(email, code):
    host = os.getenv("SMTP_HOST", "")
    username = os.getenv("SMTP_USERNAME", "")
    password = os.getenv("SMTP_PASSWORD", "")
    sender = os.getenv("SMTP_FROM", "")
    if not all([host, username, password, sender]):
        raise HTTPException(503, "Email delivery is not configured. Add the SMTP settings on the server.")

    try:
        port = int(os.getenv("SMTP_PORT", "587"))
        message = EmailMessage()
        message["From"] = sender
        message["To"] = email
        message["Subject"] = "Your Interview Practice verification code"
        message.set_content(
            f"Your verification code is: {code}\n\n"
            "It expires in 10 minutes. Enter it in Interview Practice to verify "
            "your email and continue. If you did not request this code, ignore this email."
        )
        context = ssl.create_default_context()
        if port == 465:
            connection = smtplib.SMTP_SSL(host, port, timeout=15, context=context)
        else:
            connection = smtplib.SMTP(host, port, timeout=15)
        with connection as smtp:
            if port != 465:
                smtp.starttls(context=context)
            smtp.login(username, password)
            smtp.send_message(message)
    except (smtplib.SMTPException, OSError, ValueError):
        raise HTTPException(503, "The verification email could not be sent. Check SMTP settings and try again.") from None
