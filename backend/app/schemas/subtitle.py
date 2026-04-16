from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class SubtitleFileOut(BaseModel):
    id: int
    filename: str
    youtube_id: Optional[str] = None
    language: Optional[str] = None
    total_segments: int
    created_at: datetime

    class Config:
        from_attributes = True


class SegmentRefFileOut(BaseModel):
    id: int
    filename: str
    youtube_id: Optional[str] = None

    class Config:
        from_attributes = True


class SegmentRefOut(BaseModel):
    id: int
    start_ms: int
    end_ms: int
    text: str
    file: SegmentRefFileOut

    class Config:
        from_attributes = True


class WordVideoRefOut(BaseModel):
    id: int
    word_id: int
    segment_id: int
    segment: SegmentRefOut

    class Config:
        from_attributes = True


class SegmentContextOut(BaseModel):
    before: list[SegmentRefOut] = []
    segment: SegmentRefOut
    after: list[SegmentRefOut] = []


class ReindexRequest(BaseModel):
    min_refs: int = 0   # 0 = full reindex; >0 = only words with fewer refs
    max_refs: int = 0   # 0 = use DEFAULT_MAX_REFS
    use_palabra: bool = True
    use_audio_text: bool = True
    use_significado: bool = True


class FileRefCountOut(BaseModel):
    file_id: int
    count: int


class SubtitleSearchOut(BaseModel):
    results: list[SegmentRefOut]
    total: int
