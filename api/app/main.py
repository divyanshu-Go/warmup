import psycopg
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .db import check_database
from .auth import FRONTEND_ORIGINS, router as auth_router
from .resumes import router as resume_router
from .interviews import router as interview_router

app = FastAPI(title="Interview Practice API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

app.include_router(resume_router)
app.include_router(auth_router)
app.include_router(interview_router)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/health/db")
def database_health():
    try:
        if not check_database():
            raise RuntimeError("Unexpected database response")
    except (psycopg.Error, RuntimeError, ValueError):
        raise HTTPException(
            status_code=503,
            detail="Database unavailable. Check server configuration and network access.",
        ) from None
    return {"status": "ok", "database": "connected"}
