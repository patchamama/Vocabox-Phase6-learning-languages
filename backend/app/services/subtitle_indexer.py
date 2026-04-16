import re
from collections import defaultdict
from typing import Callable, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models.subtitle import SubtitleFile, SubtitleSegment
from ..models.user_word import UserWord
from ..models.word_video_ref import WordVideoRef

DEFAULT_MAX_REFS = 10

# Tokens that look like abbreviations: up to 5 chars ending in a dot (etw., jmdm., usw., z.B.)
ACRONYM_RE = re.compile(r'^[\w.]{1,5}\.$', re.IGNORECASE)


def _user_file_ids(user_id: int, db: Session) -> list[int]:
    return [r.id for r in db.query(SubtitleFile.id).filter(SubtitleFile.user_id == user_id).all()]


def _strip_acronyms(text: str) -> list[str]:
    """Remove abbreviation tokens (e.g. 'etw.', 'jmdm.', 'z.B.') from a phrase.
    Returns list of remaining lowercase tokens."""
    tokens = text.lower().split()
    return [t for t in tokens if not ACRONYM_RE.match(t)]


def _and_search(
    file_ids: list[int],
    tokens: list[str],
    db: Session,
) -> list[SubtitleSegment]:
    """Find segments containing ALL tokens (order-independent, case-insensitive)."""
    query = db.query(SubtitleSegment).filter(SubtitleSegment.file_id.in_(file_ids))
    for token in tokens:
        query = query.filter(SubtitleSegment.text_lower.contains(token))
    return query.all()


def index_word(
    word_id: int,
    palabra: str,
    significado: str,
    user_id: int,
    db: Session,
    audio_text: Optional[str] = None,
    max_refs: int = DEFAULT_MAX_REFS,
) -> int:
    """Rebuild video refs for one (user, word) pair. Returns number of refs written."""
    file_ids = _user_file_ids(user_id, db)
    if not file_ids:
        return 0

    raw = [palabra, significado]
    if audio_text:
        raw.append(audio_text)

    terms = sorted(
        {t.lower().strip() for t in raw if len(t.strip()) >= 2},
        key=len,
        reverse=True,
    )
    if not terms:
        return 0

    seen: set[int] = set()
    by_file: dict[int, list[SubtitleSegment]] = defaultdict(list)

    for term in terms:
        rows = (
            db.query(SubtitleSegment)
            .filter(
                SubtitleSegment.file_id.in_(file_ids),
                SubtitleSegment.text_lower.contains(term),
            )
            .all()
        )
        for seg in rows:
            if seg.id not in seen:
                seen.add(seg.id)
                by_file[seg.file_id].append(seg)

    # ── Fallback: strip acronyms → AND-search remaining tokens ──────────────────
    if not by_file:
        primary = (audio_text or palabra).strip()
        stripped = _strip_acronyms(primary)
        # Only attempt fallback if stripping actually removed something
        if stripped and stripped != primary.lower().split():
            if len(stripped) == 1:
                fallback_rows = (
                    db.query(SubtitleSegment)
                    .filter(
                        SubtitleSegment.file_id.in_(file_ids),
                        SubtitleSegment.text_lower.contains(stripped[0]),
                    )
                    .all()
                )
            else:
                # Multiple tokens (may include prepositions) → AND search
                fallback_rows = _and_search(file_ids, stripped, db)

            for seg in fallback_rows:
                if seg.id not in seen:
                    seen.add(seg.id)
                    by_file[seg.file_id].append(seg)

    if not by_file:
        return 0

    # Round-robin across files to maximise diversity
    selected: list[SubtitleSegment] = []
    file_order = list(by_file.keys())
    cursors = {fid: 0 for fid in file_order}
    while len(selected) < max_refs:
        added = False
        for fid in file_order:
            if len(selected) >= max_refs:
                break
            idx = cursors[fid]
            if idx < len(by_file[fid]):
                selected.append(by_file[fid][idx])
                cursors[fid] += 1
                added = True
        if not added:
            break

    # Delete existing refs for this user+word (not global word_id)
    db.query(WordVideoRef).filter(
        WordVideoRef.user_id == user_id,
        WordVideoRef.word_id == word_id,
    ).delete()

    for seg in selected:
        db.add(WordVideoRef(user_id=user_id, word_id=word_id, segment_id=seg.id))

    db.commit()
    return len(selected)


def reindex_all(
    user_id: int,
    db: Session,
    on_progress: Optional[Callable[[int, int], None]] = None,
    min_refs: int = 0,
    max_refs: int = DEFAULT_MAX_REFS,
) -> dict:
    """Rebuild word→video refs for a specific user.

    If min_refs > 0, only process words that currently have fewer than min_refs refs
    (words already at or above the threshold are skipped).
    If min_refs == 0, all refs are deleted first and then fully regenerated.
    max_refs controls the cap per word.
    """
    uw_rows = (
        db.query(UserWord)
        .filter(UserWord.user_id == user_id)
        .join(UserWord.word)
        .all()
    )

    if min_refs > 0:
        # Partial reindex: skip words that already have enough refs
        ref_counts: dict[int, int] = {
            r.word_id: r.count
            for r in db.query(
                WordVideoRef.word_id,
                func.count(WordVideoRef.id).label("count"),
            )
            .filter(WordVideoRef.user_id == user_id)
            .group_by(WordVideoRef.word_id)
            .all()
        }
        uw_rows = [uw for uw in uw_rows if ref_counts.get(uw.word_id, 0) < min_refs]
    else:
        # Full reindex: bulk-delete all refs first
        db.query(WordVideoRef).filter(WordVideoRef.user_id == user_id).delete()
        db.commit()

    total = len(uw_rows)
    refs_total = 0
    for i, uw in enumerate(uw_rows):
        refs_total += index_word(
            uw.word_id, uw.word.palabra, uw.word.significado, user_id, db,
            audio_text=uw.word.audio_text,
            max_refs=max_refs,
        )
        if on_progress:
            on_progress(i + 1, total)

    return {"total_words": total, "refs_created": refs_total}
