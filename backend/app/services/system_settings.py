"""App-wide system settings stored in DB.

DB value (if set) takes precedence over environment variable. Frontend admin
can set / clear values without touching the .env file.
"""

from __future__ import annotations

import os
from typing import Optional

from ..database import SessionLocal
from ..models.system_setting import SystemSetting

YOUTUBE_PROXY_KEY = "youtube_proxy_url"
YOUTUBE_PROXY_STICKY_SESSION_KEY = "youtube_proxy_sticky_session"
YOUTUBE_PROXY_STICKY_UNSUPPORTED_KEY = "youtube_proxy_sticky_unsupported"
YOUTUBE_COOKIES_KEY = "youtube_cookies_netscape"
LEO_LAST_WORKING_PROXY_KEY = "leo_last_working_proxy"


def _get_setting(key: str) -> Optional[str]:
    db = SessionLocal()
    try:
        row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
        if row and row.value is not None:
            v = row.value.strip()
            return v or None
        return None
    finally:
        db.close()


def set_setting(key: str, value: Optional[str]) -> None:
    db = SessionLocal()
    try:
        row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
        new_val = (value or "").strip() or None
        if row is None:
            if new_val is None:
                return
            db.add(SystemSetting(key=key, value=new_val))
        else:
            row.value = new_val
        db.commit()
    finally:
        db.close()


def get_youtube_proxy_url() -> Optional[str]:
    """Resolve effective proxy URL. DB override wins over env var."""
    db_val = _get_setting(YOUTUBE_PROXY_KEY)
    if db_val:
        return db_val
    env_val = (os.environ.get("YOUTUBE_PROXY_URL") or "").strip()
    return env_val or None


def get_leo_last_working_proxy() -> Optional[str]:
    """Return the exact proxy URL that last produced a valid LEO response."""
    return _get_setting(LEO_LAST_WORKING_PROXY_KEY)


def set_leo_last_working_proxy(proxy_url: Optional[str]) -> None:
    """Persist the exact successful LEO proxy independently from YouTube."""
    set_setting(LEO_LAST_WORKING_PROXY_KEY, proxy_url)


def get_youtube_cookies_text() -> Optional[str]:
    """Resolve YouTube cookies in Netscape format. DB value wins over env var."""
    db_val = _get_setting(YOUTUBE_COOKIES_KEY)
    if db_val:
        return db_val
    env_val = (os.environ.get("YOUTUBE_COOKIES") or "").strip()
    return env_val or None


def get_youtube_cookies_source() -> str:
    """Return 'db' | 'env' | 'none' for the effective cookies source."""
    if _get_setting(YOUTUBE_COOKIES_KEY):
        return "db"
    if (os.environ.get("YOUTUBE_COOKIES") or "").strip():
        return "env"
    return "none"


def get_sticky_session() -> Optional[str]:
    return _get_setting(YOUTUBE_PROXY_STICKY_SESSION_KEY)


def set_sticky_session(token: Optional[str]) -> None:
    set_setting(YOUTUBE_PROXY_STICKY_SESSION_KEY, token)


def is_sticky_supported() -> bool:
    """True unless we've previously detected the proxy plan doesn't support sessions."""
    return _get_setting(YOUTUBE_PROXY_STICKY_UNSUPPORTED_KEY) != "true"


def mark_sticky_unsupported() -> None:
    set_setting(YOUTUBE_PROXY_STICKY_UNSUPPORTED_KEY, "true")


def reset_sticky_support() -> None:
    set_setting(YOUTUBE_PROXY_STICKY_UNSUPPORTED_KEY, None)


def get_youtube_proxy_source() -> str:
    """Return 'db' | 'env' | 'none' — where the effective value comes from."""
    if _get_setting(YOUTUBE_PROXY_KEY):
        return "db"
    if (os.environ.get("YOUTUBE_PROXY_URL") or "").strip():
        return "env"
    return "none"
