from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class TemaRef(BaseModel):
    id: int
    nombre: str
    color: str = "#3B82F6"

    class Config:
        from_attributes = True


class SubtitleFileOut(BaseModel):
    id: int
    filename: str
    youtube_id: Optional[str] = None
    language: Optional[str] = None
    total_segments: int
    stars: int = 0
    created_at: datetime
    temas: List[TemaRef] = []

    class Config:
        from_attributes = True


class SubtitleFileUpdate(BaseModel):
    stars: Optional[int] = Field(default=None, ge=0, le=3)
    tema_ids: Optional[List[int]] = None
    language: Optional[str] = None


class SubtitleBulkUpdate(BaseModel):
    file_ids: List[int]
    stars: Optional[int] = Field(default=None, ge=0, le=3)
    tema_ids: Optional[List[int]] = None
    language: Optional[str] = None


class YouTubeImportRequest(BaseModel):
    sources: List[str]                       # mix of video URLs, video IDs, playlist URLs or playlist IDs
    language: str                            # e.g. "de"
    fallback_languages: List[str] = []       # tried in order if requested lang missing
    tema_ids: List[int] = []
    stars: int = Field(default=0, ge=0, le=3)
    max_videos: int = Field(default=50, ge=1, le=500)


class SubtitlePlaylistOut(BaseModel):
    id: int
    playlist_id: str
    title: Optional[str] = None
    source_url: Optional[str] = None
    language: Optional[str] = None
    fallback_languages: str = ""
    max_videos: int = 50
    stars: int = 0
    created_at: datetime
    updated_at: datetime
    temas: List[TemaRef] = []

    class Config:
        from_attributes = True


class SubtitlePlaylistUpdate(BaseModel):
    title: Optional[str] = None
    language: Optional[str] = None
    fallback_languages: Optional[List[str]] = None
    max_videos: Optional[int] = Field(default=None, ge=1, le=500)
    stars: Optional[int] = Field(default=None, ge=0, le=3)
    tema_ids: Optional[List[int]] = None


class YouTubeImportItem(BaseModel):
    video_id: str
    status: str   # 'created' | 'skipped' | 'error'
    file_id: Optional[int] = None
    filename: Optional[str] = None
    segments: int = 0
    error: Optional[str] = None


class YouTubeImportResult(BaseModel):
    items: List[YouTubeImportItem]
    created: int
    skipped: int
    errors: int


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
