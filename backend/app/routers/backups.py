from datetime import datetime, timezone
from pathlib import Path
import sqlite3

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..database import engine
from ..dependencies import get_current_admin
from ..models.user import User

router = APIRouter(prefix="/backups", tags=["backups"])


class BackupInfo(BaseModel):
    filename: str
    created_at: str
    size_bytes: int


def _sqlite_database_path() -> Path:
    if engine.url.get_backend_name() != "sqlite":
        raise HTTPException(status_code=400, detail="Backups are only available for SQLite databases")
    database = engine.url.database
    if not database or database == ":memory:":
        raise HTTPException(status_code=400, detail="No database file is configured")
    return Path(database).resolve()


def _backup_dir() -> Path:
    db_path = _sqlite_database_path()
    path = db_path.parent / "backups"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _backup_info(path: Path) -> BackupInfo:
    stat = path.stat()
    created = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
    return BackupInfo(filename=path.name, created_at=created, size_bytes=stat.st_size)


def _find_backup(filename: str) -> Path:
    if Path(filename).name != filename or not filename.startswith("vocabox-backup-") or not filename.endswith(".db"):
        raise HTTPException(status_code=404, detail="Backup not found")
    path = _backup_dir() / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Backup not found")
    return path


@router.get("", response_model=list[BackupInfo])
def list_backups(_: User = Depends(get_current_admin)):
    backups = sorted(_backup_dir().glob("vocabox-backup-*.db"), key=lambda p: p.stat().st_mtime, reverse=True)
    return [_backup_info(path) for path in backups]


@router.post("", response_model=BackupInfo)
def create_backup(_: User = Depends(get_current_admin)):
    db_path = _sqlite_database_path()
    if not db_path.is_file():
        raise HTTPException(status_code=404, detail="Database file not found")

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    backup_path = _backup_dir() / f"vocabox-backup-{timestamp}.db"

    source = sqlite3.connect(str(db_path))
    try:
        destination = sqlite3.connect(str(backup_path))
        try:
            source.backup(destination)
        finally:
            destination.close()
    finally:
        source.close()

    return _backup_info(backup_path)


@router.get("/{filename}/download")
def download_backup(filename: str, _: User = Depends(get_current_admin)):
    path = _find_backup(filename)
    return FileResponse(
        str(path),
        media_type="application/octet-stream",
        filename=path.name,
    )
