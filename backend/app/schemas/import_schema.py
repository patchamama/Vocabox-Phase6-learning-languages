from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class ImportRowPreview(BaseModel):
    palabra: str
    significado: str
    idioma_origen: str
    idioma_destino: str
    is_duplicate: bool
    box_level: Optional[int] = None
    next_review_date: Optional[datetime] = None


class ImportPreviewOut(BaseModel):
    rows: List[ImportRowPreview]
    total: int
    new_count: int
    duplicate_count: int
    source_lang: str   # human-readable name detected from file
    target_lang: str
    source_code: str   # ISO code resolved from dictionary
    target_code: str


class ImportConfirmIn(BaseModel):
    rows: List[ImportRowPreview]
    tema_id: Optional[int] = None


class ImportResultOut(BaseModel):
    imported: int
    skipped: int
