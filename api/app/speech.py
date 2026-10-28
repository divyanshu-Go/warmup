from io import BytesIO
import textwrap
import wave

from fastapi import HTTPException
from groq import APIError, APIStatusError

from .ai import get_groq_client

MAX_AUDIO_BYTES = 10 * 1024 * 1024
MAX_AUDIO_SECONDS = 300
TTS_MODEL = "canopylabs/orpheus-v1-english"
TTS_VOICE = "autumn"


def speech_chunks(text):
    return textwrap.wrap(" ".join(text.split()), width=200, break_on_hyphens=False)


def synthesize_question(text):
    chunks = speech_chunks(text)
    if not chunks:
        raise HTTPException(502, "The saved question has no text to read.")
    output = BytesIO()
    try:
        frames = []
        expected_format = None
        with get_groq_client() as client:
            for chunk in chunks:
                audio = client.audio.speech.create(
                    model=TTS_MODEL, voice=TTS_VOICE, response_format="wav", input=chunk,
                ).read()
                with wave.open(BytesIO(audio), "rb") as reader:
                    audio_format = (reader.getnchannels(), reader.getsampwidth(), reader.getframerate(), reader.getcomptype(), reader.getcompname())
                    if expected_format is None:
                        expected_format = audio_format
                    elif audio_format != expected_format:
                        raise ValueError("Inconsistent speech format")
                    if reader.getnframes() == 0:
                        raise ValueError("Empty speech audio")
                    frames.append(reader.readframes(reader.getnframes()))
        with wave.open(output, "wb") as writer:
            writer.setparams((*expected_format[:3], 0, *expected_format[3:]))
            writer.writeframes(b"".join(frames))
    except APIStatusError as error:
        if error.status_code in (401, 403):
            raise HTTPException(503, "Question voice is unavailable. Check the Groq key and Orpheus model access in your Groq project.") from None
        if error.status_code == 429:
            raise HTTPException(503, "Question voice rate limit reached. Please retry shortly.") from None
        raise HTTPException(502, "Question voice generation failed. Please retry Speak question.") from None
    except APIError:
        raise HTTPException(502, "Question voice service is unavailable. Please retry Speak question.") from None
    except (wave.Error, EOFError, ValueError):
        raise HTTPException(502, "The voice service returned unreadable audio. Please retry Speak question.") from None
    return output.getvalue()


def recording_filename(content):
    # Use container signatures, not a client-supplied extension or MIME type.
    if content.startswith(b"\x1a\x45\xdf\xa3"):
        return "answer.webm"
    if content.startswith(b"OggS"):
        return "answer.ogg"
    if content[4:8] == b"ftyp":
        return "answer.mp4"
    if content.startswith(b"RIFF") and content[8:12] == b"WAVE":
        return "answer.wav"
    raise HTTPException(415, "Unsupported recording. Please record audio again using this page.")


def transcribe_recording(content, filename):
    try:
        with get_groq_client() as client:
            result = client.audio.transcriptions.create(
                file=(filename, content), model="whisper-large-v3-turbo",
                temperature=0, response_format="verbose_json", language="en",
            )
    except APIStatusError as error:
        if error.status_code in (400, 413, 422):
            raise HTTPException(400, "The recording could not be decoded. Please record your answer again.") from None
        raise HTTPException(502, "Speech transcription is unavailable. Please retry your recording shortly.") from None
    except APIError:
        raise HTTPException(502, "Speech transcription failed. Please retry your recording shortly.") from None

    duration = getattr(result, "duration", None)
    if isinstance(duration, (int, float)) and duration > MAX_AUDIO_SECONDS:
        raise HTTPException(400, "Please keep your recording within 5 minutes.")
    segments = getattr(result, "segments", None) or []
    segments = [segment for segment in segments if isinstance(segment, dict)]
    if segments and all(segment.get("no_speech_prob", 0) > 0.8 and segment.get("avg_logprob", 0) < -1 for segment in segments):
        raise HTTPException(400, "No clear speech was detected. Please record your answer again.")
    text = (result.text or "").strip()
    if not text:
        raise HTTPException(400, "No speech was transcribed. Please record your answer again.")
    if len(text) > 10_000:
        raise HTTPException(400, "The transcript is too long. Please record a shorter answer.")
    return text
