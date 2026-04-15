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
from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional

import openpyxl
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
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


def parse_csv(content: bytes) -> tuple[list[tuple], bool]:
    """Returns (rows, is_vocabox_format).

    Vocabox format: palabra, significado, idioma_origen_name, idioma_destino_name, box_level, next_review_date
    Google Translate format: idioma_origen_name, idioma_destino_name, palabra, significado
    """
    text = content.decode("utf-8", errors="replace")
    rows = []
    is_vocabox = False
    for i, row in enumerate(csv.reader(io.StringIO(text))):
        if len(row) < 4:
            continue
        cols = [c.strip() for c in row]
        c1, c2, c3, c4 = cols[:4]
        if i == 0 and c1.lower() == "palabra":
            is_vocabox = True
            continue  # skip header
        if not (c1 and c2 and c3 and c4):
            continue
        c5 = cols[4] if len(cols) > 4 else ""
        c6 = cols[5] if len(cols) > 5 else ""
        c7 = cols[6] if len(cols) > 6 else ""
        c8 = cols[7] if len(cols) > 7 else ""
        rows.append((c1, c2, c3, c4, c5, c6, c7, c8))
    return rows, is_vocabox


def parse_xlsx(content: bytes) -> tuple[list[tuple], bool]:
    """Returns (rows, is_vocabox_format)."""
    wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    ws = wb.active
    rows = []
    is_vocabox = False
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if len(row) < 4:
            continue
        c1 = str(row[0] or "").strip()
        c2 = str(row[1] or "").strip()
        c3 = str(row[2] or "").strip()
        c4 = str(row[3] or "").strip()
        if i == 0 and c1.lower() == "palabra":
            is_vocabox = True
            continue  # skip header
        if i == 0 and (not c3 or not c4):
            continue  # Google Translate header row
        if c1 and c2 and c3 and c4:
            c5 = str(row[4] or "").strip() if len(row) > 4 else ""
            c6 = str(row[5] or "").strip() if len(row) > 5 else ""
            c7 = str(row[6] or "").strip() if len(row) > 6 else ""
            c8 = str(row[7] or "").strip() if len(row) > 7 else ""
            rows.append((c1, c2, c3, c4, c5, c6, c7, c8))
    wb.close()
    return rows, is_vocabox


def parse_leo_pdf(content: bytes) -> list[tuple[str, str]]:
    """Extract (src_word, tgt_word) pairs from a LEO vocabulary PDF.

    LEO exports a two-column PDF (German left, target lang right).
    We split by the page midpoint x-coordinate and group words by
    row using a 20-point vertical tolerance.
    """
    try:
        import pdfplumber
    except ImportError:
        raise HTTPException(
            status_code=422,
            detail="pdfplumber is required for PDF import. Run: pip install pdfplumber",
        )

    pairs: list[tuple[str, str]] = []
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        for page in pdf.pages:
            words = page.extract_words()
            if not words:
                continue
            mid_x = page.width * 0.52
            rows: dict = defaultdict(lambda: {"left": [], "right": []})
            for w in words:
                y_key = round(w["top"] / 20) * 20
                if w["x0"] < mid_x:
                    rows[y_key]["left"].append((w["x0"], w["top"], w["text"]))
                else:
                    rows[y_key]["right"].append((w["x0"], w["top"], w["text"]))

            for y in sorted(rows.keys()):
                lw = sorted(rows[y]["left"], key=lambda w: (round(w[1] / 3) * 3, w[0]))
                rw = sorted(rows[y]["right"], key=lambda w: (round(w[1] / 3) * 3, w[0]))
                left = " ".join(t for _, _, t in lw).strip()
                right = " ".join(t for _, _, t in rw).strip()
                if left and right:
                    pairs.append((left, right))
    return pairs


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

    raw_rows, is_vocabox = parse_csv(content) if filename.endswith(".csv") else parse_xlsx(content)
    if not raw_rows:
        raise HTTPException(status_code=400, detail="No valid rows found in the file")

    # Detect language pair.
    # Vocabox format: (palabra, significado, src_lang_name, dst_lang_name, box_level, date)
    # Google Translate format: (src_lang_name, dst_lang_name, palabra, significado, "", "")
    if is_vocabox:
        src_lang_name = raw_rows[0][2]
        tgt_lang_name = raw_rows[0][3]
    else:
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

    for row in raw_rows:
        # Pad to 8 fields so unpacking is always safe
        padded = tuple(row) + ("",) * (8 - len(row))
        if is_vocabox:
            src_word, tgt_word, _, _, box_str, date_str, category_str, source_str = padded[:8]
        else:
            _, _, src_word, tgt_word, box_str, date_str, category_str, source_str = padded[:8]

        if not src_word or not tgt_word:
            continue

        # Parse optional Vocabox fields
        box_level: Optional[int] = None
        next_review_date: Optional[datetime] = None
        if is_vocabox:
            try:
                box_level = int(box_str) if box_str else None
            except ValueError:
                box_level = None
            try:
                next_review_date = datetime.fromisoformat(date_str) if date_str else None
            except ValueError:
                next_review_date = None

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
                box_level=box_level,
                next_review_date=next_review_date,
                category=category_str or None,
                source=source_str or None,
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


@router.post("/pdf-preview", response_model=ImportPreviewOut)
async def pdf_preview_import(
    file: UploadFile = File(...),
    src_lang: str = Query("de", description="Source language ISO code"),
    tgt_lang: str = Query("es", description="Target language ISO code"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    filename = (file.filename or "").lower()
    if not filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only .pdf files are supported here")

    content = await file.read()
    raw_pairs = parse_leo_pdf(content)
    if not raw_pairs:
        raise HTTPException(status_code=400, detail="No word pairs found in the PDF")

    src_code = resolve_lang_code(src_lang, db) or src_lang
    tgt_code = resolve_lang_code(tgt_lang, db) or tgt_lang

    # Human-readable lang names from the DB (fallback to code)
    from ..models.language_dict import LanguageDict
    src_entry = db.query(LanguageDict).filter(LanguageDict.code == src_code).first()
    tgt_entry = db.query(LanguageDict).filter(LanguageDict.code == tgt_code).first()
    src_lang_name = src_entry.name_es if src_entry else src_code
    tgt_lang_name = tgt_entry.name_es if tgt_entry else tgt_code

    # Build normalized existing-word set
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

    seen_in_file: set[tuple[str, str, str, str]] = set()
    preview_rows: list[ImportRowPreview] = []

    for src_word, tgt_word in raw_pairs:
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
                source="leo",
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
                category=row.category or None,
                source=row.source or None,
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
                    box_level=row.box_level if row.box_level is not None else 0,
                    next_review_date=row.next_review_date if row.next_review_date is not None else now,
                )
            )
            imported += 1
        else:
            skipped += 1

    db.commit()
    return ImportResultOut(imported=imported, skipped=skipped)
