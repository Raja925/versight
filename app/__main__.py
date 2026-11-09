"""`python -m app` starts the server on 127.0.0.1 only, unless VERSIGHT_HOST says otherwise."""
import os

import uvicorn

if __name__ == "__main__":
    host = os.getenv("VERSIGHT_HOST", "127.0.0.1")
    port = int(os.getenv("VERSIGHT_PORT", "8000"))
    if host not in ("127.0.0.1", "localhost", "::1"):
        print(
            "WARNING: the server has no login. Anyone who can reach it can use your Anthropic API key. "
            "Put it behind authentication before exposing it."
        )
    uvicorn.run("app.main:app", host=host, port=port)
