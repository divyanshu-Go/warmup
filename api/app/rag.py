from functools import lru_cache
from pathlib import Path


CHROMA_PATH = Path(__file__).resolve().parent.parent / "chroma_db"
COLLECTION_NAME = "resume_context_v1"
CHUNK_SIZE = 500
CHUNK_OVERLAP = 50


@lru_cache(maxsize=1)
def get_collection():
    # Keep model loading and vector storage out of API startup and normal uploads.
    import chromadb
    from chromadb.config import Settings
    from chromadb.utils.embedding_functions import ONNXMiniLM_L6_V2

    client = chromadb.PersistentClient(
        path=str(CHROMA_PATH), settings=Settings(anonymized_telemetry=False),
    )
    return client.get_or_create_collection(
        name=COLLECTION_NAME,
        embedding_function=ONNXMiniLM_L6_V2(),
        metadata={"hnsw:space": "cosine"},
    )


def split_resume(text):
    chunks = []
    for start in range(0, len(text), CHUNK_SIZE - CHUNK_OVERLAP):
        chunk = text[start:start + CHUNK_SIZE].strip()
        if chunk:
            chunks.append(chunk)
    return chunks


def retrieve_context(user_id, resume_id, raw_text, query):
    chunks = split_resume(raw_text)
    if not chunks:
        return {"resume_id": str(resume_id), "indexed_chunks": 0, "matches": []}

    collection = get_collection()
    scope = {"$and": [{"user_id": str(user_id)}, {"resume_id": str(resume_id)}]}
    ids = [f"{user_id}:{resume_id}:{index}" for index in range(len(chunks))]
    stored = collection.get(where=scope, include=[])
    if set(stored["ids"]) != set(ids):
        # Resume text is immutable per upload. Stable IDs make retries idempotent.
        collection.upsert(
            ids=ids, documents=chunks,
            metadatas=[{"user_id": str(user_id), "resume_id": str(resume_id), "chunk": index}
                       for index in range(len(chunks))],
        )

    result = collection.query(
        query_texts=[query], where=scope, n_results=min(3, len(chunks)),
        include=["documents", "metadatas"],
    )
    matches = [{"text": text, "chunk": metadata["chunk"]}
               for text, metadata in zip(result["documents"][0], result["metadatas"][0])]
    return {"resume_id": str(resume_id), "indexed_chunks": len(chunks), "matches": matches}
