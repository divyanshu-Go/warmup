import os
from fastapi import HTTPException
from groq import Groq


def get_groq_client():
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(503, "AI is not configured. Set GROQ_API_KEY on the server.")
    return Groq(api_key=api_key, timeout=60, max_retries=0)
