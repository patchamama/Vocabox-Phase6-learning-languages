import re
from collections import defaultdict
from typing import Callable, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models.subtitle import SubtitleFile, SubtitleSegment, subtitle_file_temas
from ..models.user_word import UserWord
from ..models.word_video_ref import WordVideoRef

DEFAULT_MAX_REFS = 10

# Tokens that look like abbreviations: up to 5 chars ending in a dot (etw., jmdm., usw., z.B.)
ACRONYM_RE = re.compile(r'^[\w.]{1,5}\.$', re.IGNORECASE)


def _user_files_ordered(user_id: int, db: Session) -> list[tuple[int, int]]:
    """Return (file_id, stars) for user's files, sorted by stars desc, id asc."""
    rows = (
        db.query(SubtitleFile.id, SubtitleFile.stars)
        .filter(SubtitleFile.user_id == user_id)
        .order_by(SubtitleFile.stars.desc(), SubtitleFile.id.asc())
        .all()
    )
    return [(r.id, r.stars or 0) for r in rows]


def _user_file_ids(user_id: int, db: Session) -> list[int]:
    return [fid for fid, _ in _user_files_ordered(user_id, db)]


def _files_for_word_tema(
    user_id: int,
    word_tema_id: Optional[int],
    db: Session,
) -> list[int]:
    """Return file_ids eligible for a word with the given tema, ordered by stars desc.

    Rules (strict tema match):
    - word with tema T → files where T is in their temas OR files with no temas at all
    - word without tema → all files
    """
    all_files = _user_files_ordered(user_id, db)
    if not all_files:
        return []
    if word_tema_id is None:
        return [fid for fid, _ in all_files]

    # File ids that have ANY tema linked
    tagged_file_ids = {
        r.subtitle_file_id
        for r in db.query(subtitle_file_temas.c.subtitle_file_id)
        .filter(subtitle_file_temas.c.subtitle_file_id.in_([f[0] for f in all_files]))
        .all()
    }
    # File ids linked to this specific tema
    matching_file_ids = {
        r.subtitle_file_id
        for r in db.query(subtitle_file_temas.c.subtitle_file_id)
        .filter(
            subtitle_file_temas.c.subtitle_file_id.in_([f[0] for f in all_files]),
            subtitle_file_temas.c.tema_id == word_tema_id,
        )
        .all()
    }
    return [
        fid for fid, _ in all_files
        if fid in matching_file_ids or fid not in tagged_file_ids
    ]


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
    use_palabra: bool = True,
    use_audio_text: bool = True,
    use_significado: bool = True,
    word_tema_id: Optional[int] = None,
) -> int:
    """Rebuild video refs for one (user, word) pair. Returns number of refs written."""
    file_ids = _files_for_word_tema(user_id, word_tema_id, db)
    if not file_ids:
        return 0

    raw: list[str] = []
    if use_palabra and palabra:
        raw.append(palabra)
    if use_significado and significado:
        raw.append(significado)
    if use_audio_text and audio_text:
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

    # Round-robin across files, preserving stars-desc order from file_ids
    selected: list[SubtitleSegment] = []
    file_order = [fid for fid in file_ids if fid in by_file]
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
    use_palabra: bool = True,
    use_audio_text: bool = True,
    use_significado: bool = True,
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
            use_palabra=use_palabra,
            use_audio_text=use_audio_text,
            use_significado=use_significado,
            word_tema_id=uw.word.tema_id,
        )
        if on_progress:
            on_progress(i + 1, total)

    return {"total_words": total, "refs_created": refs_total}
