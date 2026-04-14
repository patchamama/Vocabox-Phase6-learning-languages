"""
Entry point for running the Vocabox API server.
The port is read from the PORT variable in the .env file (default: 9009).

Usage:
    python run.py
"""
import logging
import uvicorn

from app.config import settings

# Ensure our app loggers appear at INFO level alongside uvicorn output
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
)

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=settings.PORT,
        reload=True,
        log_level="info",
    )
