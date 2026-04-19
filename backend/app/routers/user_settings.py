"""
user_settings.py — Persist per-user app settings as a JSON blob.

GET  /user-settings   — return current settings (empty dict if none)
PUT  /user-settings   — full-replace settings JSON
"""

import json
from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies import get_current_user
from ..models.user import User
from ..models.user_settings import UserSettings

router = APIRouter(prefix="/user-settings", tags=["user-settings"])


class SettingsPayload(BaseModel):
    settings: dict


@router.get("")
def get_settings(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the user's stored settings, or {} if none exist yet."""
    row = db.query(UserSettings).filter_by(user_id=current_user.id).first()
    if not row:
        return {}
    try:
        return json.loads(row.settings_json)
    except Exception:
        return {}


@router.put("")
def save_settings(
    payload: SettingsPayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Full-replace the user's settings JSON."""
    row = db.query(UserSettings).filter_by(user_id=current_user.id).first()
    blob = json.dumps(payload.settings)
    if row:
        row.settings_json = blob
        row.updated_at = datetime.utcnow()
    else:
        row = UserSettings(
            user_id=current_user.id,
            settings_json=blob,
            updated_at=datetime.utcnow(),
        )
        db.add(row)
    db.commit()
    return {"saved": True}
