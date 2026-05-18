"""YouTube subtitle import service — WIP scaffold.

Endpoint + schemas exist in routers/subtitles.py and schemas/subtitle.py
(YouTubeImportRequest/Item/Result). This module will house the actual
yt-dlp + transcript fetching pipeline that turns a list of video/playlist
sources into SubtitleFile rows.

Not implemented yet. Importing this module is a no-op so the router can
keep its `from ..services import youtube_subtitle_service as yts` line
without breaking at startup.
"""

from __future__ import annotations

from typing import List

from ..schemas.subtitle import YouTubeImportItem, YouTubeImportRequest, YouTubeImportResult


class NotImplementedYet(RuntimeError):
    pass


def import_sources(_req: YouTubeImportRequest, _user_id: int) -> YouTubeImportResult:
    """Placeholder for the youtube import pipeline.

    Raises NotImplementedYet until the yt-dlp + transcript fetcher lands.
    """
    raise NotImplementedYet("youtube_subtitle_service.import_sources is not implemented yet")


__all__: List[str] = [
    "NotImplementedYet",
    "import_sources",
    "YouTubeImportItem",
    "YouTubeImportRequest",
    "YouTubeImportResult",
]
