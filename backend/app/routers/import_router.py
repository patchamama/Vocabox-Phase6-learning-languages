"""
Import router — /import/preview and /import/confirm

Duplicate detection strategy (per user):
  - Normalize each phrase: lowercase + words sorted alphabetically.
  - "Pantalla de inicio" and "inicio de Pantalla" both → "de inicio pantalla".
  - A row is a duplicate if the user already has a UserWord whose word matches
    on (normalized_palabra, normalized_significado, idioma_origen, idioma_destino).
  - Within the uploaded file itself, later occurrences of the same pair are
    also flagged as duplicates to avoid inserting the same row twice.
"""

import csv
import io
from datetime import datetime
from typing import Optional

import openpyxl
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..dependencies import get_current_user
from ..models.language_dict import LanguageDict
from ..models.user import User
from ..models.user_word import UserWord
from ..models.word import Word
from ..schemas.import_schema import (
    ImportConfirmIn,
    ImportPreviewOut,
    ImportResultOut,
    ImportRowPreview,
)

router = APIRouter(prefix="/import", tags=["import"])

# ── Helpers ───────────────────────────────────────────────────────────────────


def normalize_phrase(text: str) -> str:
    """Lowercase + sort words so different orderings compare equal."""
    return " ".join(sorted(text.lower().strip().split()))


def resolve_lang_code(lang_name: str, db: Session) -> str:
    """Look up a language name (in any UI language) and return its ISO code."""
    name = lang_name.strip().lower()
    entry = (
        db.query(LanguageDict)
        .filter(
            LanguageDict.name_es.ilike(name)
            | LanguageDict.name_en.ilike(name)
            | LanguageDict.name_de.ilike(name)
            | LanguageDict.name_fr.ilike(name)
        )
        .first()
    )
    # Fallback: use first two chars of the name as a best-effort code
    return entry.code if entry else name[:2]


def parse_csv(content: bytes) -> list[tuple[str, str, str, str]]:
    text = content.decode("utf-8", errors="replace")
    rows = []
    for row in csv.reader(io.StringIO(text)):
        if len(row) >= 4:
            c1, c2, c3, c4 = (c.strip() for c in row[:4])
            if c1 and c2 and c3 and c4:
                rows.append((c1, c2, c3, c4))
    return rows


def parse_xlsx(content: bytes) -> list[tuple[str, str, str, str]]:
    wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    ws = wb.active
    rows = []
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if len(row) < 4:
            continue
        c1 = str(row[0] or "").strip()
        c2 = str(row[1] or "").strip()
        c3 = str(row[2] or "").strip()
        c4 = str(row[3] or "").strip()
        # Skip a header row if columns 3 & 4 are empty
        if i == 0 and (not c3 or not c4):
            continue
        if c1 and c2 and c3 and c4:
            rows.append((c1, c2, c3, c4))
    wb.close()
    return rows


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.post("/preview", response_model=ImportPreviewOut)
async def preview_import(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    filename = (file.filename or "").lower()
    if not (filename.endswith(".csv") or filename.endswith(".xlsx")):
        raise HTTPException(
            status_code=400, detail="Only .csv and .xlsx files are supported"
        )

    content = await file.read()

    raw_rows = parse_csv(content) if filename.endswith(".csv") else parse_xlsx(content)
    if not raw_rows:
        raise HTTPException(status_code=400, detail="No valid rows found in the file")

    # Detect language pair from first row
    src_lang_name = raw_rows[0][0]
    tgt_lang_name = raw_rows[0][1]
    src_code = resolve_lang_code(src_lang_name, db)
    tgt_code = resolve_lang_code(tgt_lang_name, db)

    # Build normalized set of words the user already has
    user_words = (
        db.query(UserWord)
        .filter(UserWord.user_id == current_user.id)
        .options(joinedload(UserWord.word))
        .all()
    )
    existing: set[tuple[str, str, str, str]] = {
        (
            normalize_phrase(uw.word.palabra),
            normalize_phrase(uw.word.significado),
            uw.word.idioma_origen,
            uw.word.idioma_destino,
        )
        for uw in user_words
    }

    # Build preview
    seen_in_file: set[tuple[str, str, str, str]] = set()
    preview_rows: list[ImportRowPreview] = []

    for (_, _, src_word, tgt_word) in raw_rows:
        if not src_word or not tgt_word:
            continue

        key = (normalize_phrase(src_word), normalize_phrase(tgt_word), src_code, tgt_code)
        is_dup = key in existing or key in seen_in_file
        seen_in_file.add(key)

        preview_rows.append(
            ImportRowPreview(
                palabra=src_word,
                significado=tgt_word,
                idioma_origen=src_code,
                idioma_destino=tgt_code,
                is_duplicate=is_dup,
            )
        )

    new_count = sum(1 for r in preview_rows if not r.is_duplicate)
    dup_count = len(preview_rows) - new_count

    return ImportPreviewOut(
        rows=preview_rows,
        total=len(preview_rows),
        new_count=new_count,
        duplicate_count=dup_count,
        source_lang=src_lang_name,
        target_lang=tgt_lang_name,
        source_code=src_code,
        target_code=tgt_code,
    )


@router.post("/confirm", response_model=ImportResultOut)
def confirm_import(
    data: ImportConfirmIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    imported = 0
    skipped = 0
    now = datetime.utcnow()

    # Re-build the user's existing set for a server-side safety check
    user_words = (
        db.query(UserWord)
        .filter(UserWord.user_id == current_user.id)
        .options(joinedload(UserWord.word))
        .all()
    )
    existing: set[tuple[str, str, str, str]] = {
        (
            normalize_phrase(uw.word.palabra),
            normalize_phrase(uw.word.significado),
            uw.word.idioma_origen,
            uw.word.idioma_destino,
        )
        for uw in user_words
    }

    confirmed_this_request: set[tuple[str, str, str, str]] = set()

    for row in data.rows:
        if row.is_duplicate:
            skipped += 1
            continue

        key = (
            normalize_phrase(row.palabra),
            normalize_phrase(row.significado),
            row.idioma_origen,
            row.idioma_destino,
        )

        # Server-side duplicate guard
        if key in existing or key in confirmed_this_request:
            skipped += 1
            continue

        confirmed_this_request.add(key)

        # Reuse an existing global Word record if one matches
        candidate_words = db.query(Word).filter(
            Word.idioma_origen == row.idioma_origen,
            Word.idioma_destino == row.idioma_destino,
        ).all()

        matched_word: Optional[Word] = next(
            (
                w
                for w in candidate_words
                if normalize_phrase(w.palabra) == key[0]
                and normalize_phrase(w.significado) == key[1]
            ),
            None,
        )

        if matched_word:
            word_id = matched_word.id
        else:
            new_word = Word(
                palabra=row.palabra,
                significado=row.significado,
                idioma_origen=row.idioma_origen,
                idioma_destino=row.idioma_destino,
                tema_id=data.tema_id,
            )
            db.add(new_word)
            db.flush()
            word_id = new_word.id

        # Add to user's learning set
        already_has = db.query(UserWord).filter(
            UserWord.user_id == current_user.id,
            UserWord.word_id == word_id,
        ).first()

        if not already_has:
            db.add(
                UserWord(
                    user_id=current_user.id,
                    word_id=word_id,
                    box_level=0,
                    next_review_date=now,
                )
            )
            imported += 1
        else:
            skipped += 1

    db.commit()
    return ImportResultOut(imported=imported, skipped=skipped)
