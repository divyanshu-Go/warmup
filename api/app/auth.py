import hashlib
import hmac
import os
import re
import secrets
from contextlib import contextmanager
from uuid import UUID, uuid4

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from .db import get_connection
from .mail import send_verification_email

FRONTEND_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]
COOKIE_NAME = "interview_session"
SESSION_SECONDS = 7 * 24 * 60 * 60


def check_origin(request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    origin = request.headers.get("origin")
    if origin and origin not in [*FRONTEND_ORIGINS, str(request.base_url).rstrip("/")]:
        raise HTTPException(403, "This request origin is not allowed.")


router = APIRouter(prefix="/api/auth", dependencies=[Depends(check_origin)])


class CodeRequest(BaseModel):
    resume_id: UUID


class CodeVerification(CodeRequest):
    code: str = Field(pattern=r"^[0-9]{6}$")


@contextmanager
def database():
    try:
        with get_connection() as connection:
            yield connection
    except (psycopg.Error, RuntimeError, ValueError):
        raise HTTPException(503, "Verification storage is unavailable. Check the database and schema setup.") from None


def hash_code(code, salt):
    return hashlib.pbkdf2_hmac("sha256", code.encode(), bytes.fromhex(salt), 100_000).hex()


def hash_token(token):
    return hashlib.sha256(token.encode()).hexdigest()


def user_details(row):
    return {"id": str(row[0]), "email": row[1], "name": row[2]}


@router.post("/send-code")
def send_code(body: CodeRequest):
    with database() as connection:
        resume = connection.execute(
            "SELECT parsed_data FROM resume_uploads WHERE id = %s", (body.resume_id,),
        ).fetchone()
        if not resume:
            raise HTTPException(404, "Resume not found. Please upload it again.")
        email = (resume[0].get("email") or "").strip().lower()
        if len(email) > 254 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            raise HTTPException(400, "No valid email was found. Please upload a resume containing your email address.")

        code = f"{secrets.randbelow(1_000_000):06d}"
        salt = secrets.token_hex(16)
        updated = connection.execute(
            """INSERT INTO email_verifications (email, resume_id, code_hash, salt, expires_at)
               VALUES (%s, %s, %s, %s, CURRENT_TIMESTAMP + INTERVAL '10 minutes')
               ON CONFLICT (email) DO UPDATE SET
                   resume_id = EXCLUDED.resume_id, code_hash = EXCLUDED.code_hash,
                   salt = EXCLUDED.salt, attempts = 0, sent_at = CURRENT_TIMESTAMP,
                   expires_at = EXCLUDED.expires_at
               WHERE email_verifications.sent_at <= CURRENT_TIMESTAMP - INTERVAL '60 seconds'
               RETURNING email""",
            (email, body.resume_id, hash_code(code, salt), salt),
        ).fetchone()
        if not updated:
            raise HTTPException(429, "Please wait 60 seconds before requesting another code.")
        # Roll back the new challenge if delivery fails. Never log or return codes.
        send_verification_email(email, code)
    return {"email": email, "message": "Verification code sent. It expires in 10 minutes."}


def verify_and_create_session(body):
    with database() as connection:
        challenge = connection.execute(
            """SELECT v.email, v.code_hash, v.salt, v.attempts,
                      v.expires_at > CURRENT_TIMESTAMP, r.parsed_data, r.user_id
               FROM email_verifications v JOIN resume_uploads r ON r.id = v.resume_id
               WHERE v.resume_id = %s FOR UPDATE OF v""",
            (body.resume_id,),
        ).fetchone()
        if not challenge or challenge[3] >= 5 or not challenge[4]:
            return None
        if not hmac.compare_digest(hash_code(body.code, challenge[2]), challenge[1]):
            connection.execute(
                "UPDATE email_verifications SET attempts = attempts + 1 WHERE email = %s",
                (challenge[0],),
            )
            # Returning commits the attempt counter; raising here would roll it back.
            return None

        user = connection.execute(
            """INSERT INTO app_users (id, email, name) VALUES (%s, %s, %s)
               ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
               RETURNING id, email, name""",
            (uuid4(), challenge[0], challenge[5].get("name", "")),
        ).fetchone()
        if challenge[6] is not None and challenge[6] != user[0]:
            raise HTTPException(409, "This resume is already linked to another user.")
        connection.execute("UPDATE resume_uploads SET user_id = %s WHERE id = %s", (user[0], body.resume_id))
        connection.execute(
            "UPDATE email_verifications SET attempts = 5, expires_at = CURRENT_TIMESTAMP WHERE email = %s",
            (challenge[0],),
        )
        token = secrets.token_urlsafe(32)
        connection.execute(
            """INSERT INTO user_sessions (token_hash, user_id, expires_at)
               VALUES (%s, %s, CURRENT_TIMESTAMP + INTERVAL '7 days')""",
            (hash_token(token), user[0]),
        )
    return user_details(user), token


@router.post("/verify-code")
def verify_code(body: CodeVerification, response: Response):
    result = verify_and_create_session(body)
    if result is None:
        raise HTTPException(400, "Invalid or expired code. Request a new code if needed.")
    user, token = result
    response.set_cookie(
        COOKIE_NAME, token, max_age=SESSION_SECONDS, httponly=True,
        secure=os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true",
        samesite="lax", path="/",
    )
    return {"user": user, "resume_id": str(body.resume_id)}


def get_current_user(request: Request):
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(401, "Email verification is required.")
    with database() as connection:
        row = connection.execute(
            """SELECT u.id, u.email, u.name FROM user_sessions s
               JOIN app_users u ON u.id = s.user_id
               WHERE s.token_hash = %s AND s.expires_at > CURRENT_TIMESTAMP""",
            (hash_token(token),),
        ).fetchone()
    if not row:
        raise HTTPException(401, "Your session has expired. Please verify your email again.")
    return user_details(row)


@router.get("/me")
def current_user(user: dict = Depends(get_current_user)):
    return {"user": user}


@router.post("/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get(COOKIE_NAME)
    if token:
        with database() as connection:
            connection.execute(
                "UPDATE user_sessions SET expires_at = CURRENT_TIMESTAMP WHERE token_hash = %s",
                (hash_token(token),),
            )
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"message": "Signed out."}
