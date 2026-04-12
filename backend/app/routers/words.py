import csv
import io
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..dependencies import get_current_user
from ..models.language_dict import LanguageDict
from ..models.user import User
from ..models.user_word import UserWord
from ..models.word import Word
from ..schemas.word import UserWordOut, WordCreate, WordOut, WordUpdate

router = APIRouter(prefix="/words", tags=["words"])


@router.get("/export")
def export_words(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user_words = (
        db.query(UserWord)
        .filter(UserWord.user_id == current_user.id)
        .options(joinedload(UserWord.word))
        .all()
    )

    lang_map = {e.code: e.name_es for e in db.query(LanguageDict).all()}

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["palabra", "significado", "idioma_origen", "idioma_destino", "box_level", "next_review_date"])
    for uw in user_words:
        w = uw.word
        src = lang_map.get(w.idioma_origen, w.idioma_origen)
        dst = lang_map.get(w.idioma_destino, w.idioma_destino)
        review_date = uw.next_review_date.isoformat() if uw.next_review_date else ""
        writer.writerow([w.palabra, w.significado, src, dst, uw.box_level, review_date])

    content = output.getvalue()
    return StreamingResponse(
        iter([content]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=vocabox_export.csv"},
    )


@router.get("", response_model=List[WordOut])
def list_words(
    skip: int = 0,
    limit: int = 200,
    tema_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Return only words that belong to the current user
    subq = (
        db.query(UserWord.word_id)
        .filter(UserWord.user_id == current_user.id)
        .subquery()
    )
    query = (
        db.query(Word)
        .options(joinedload(Word.tema))
        .filter(Word.id.in_(subq))
    )
    if tema_id:
        query = query.filter(Word.tema_id == tema_id)
    return query.offset(skip).limit(limit).all()


@router.get("/my", response_model=List[UserWordOut])
def get_my_words(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return (
        db.query(UserWord)
        .filter(UserWord.user_id == current_user.id)
        .options(joinedload(UserWord.word).joinedload(Word.tema))
        .all()
    )


@router.post("", response_model=WordOut, status_code=status.HTTP_201_CREATED)
def create_word(
    data: WordCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Reuse existing word if palabra+significado already exist (case-insensitive trim)
    palabra = data.palabra.strip()
    significado = data.significado.strip()
    word = (
        db.query(Word)
        .filter(Word.palabra == palabra, Word.significado == significado)
        .first()
    )
    if not word:
        word = Word(**{**data.model_dump(), "palabra": palabra, "significado": significado})
        db.add(word)
        db.flush()

    # Only create UserWord if this user doesn't already have it
    existing_uw = (
        db.query(UserWord)
        .filter(UserWord.user_id == current_user.id, UserWord.word_id == word.id)
        .first()
    )
    if existing_uw:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Word already in your list")

    user_word = UserWord(
        user_id=current_user.id,
        word_id=word.id,
        box_level=0,
        next_review_date=datetime.utcnow(),
    )
    db.add(user_word)
    db.commit()
    db.refresh(word)
    return word


@router.put("/{word_id}", response_model=WordOut)
def update_word(
    word_id: int,
    data: WordUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user_word = (
        db.query(UserWord)
        .filter(UserWord.user_id == current_user.id, UserWord.word_id == word_id)
        .first()
    )
    if not user_word:
        raise HTTPException(status_code=404, detail="Word not found")

    word = (
        db.query(Word)
        .options(joinedload(Word.tema))
        .filter(Word.id == word_id)
        .first()
    )
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(word, field, value)
    db.commit()
    db.refresh(word)
    return word


@router.delete("/all", status_code=status.HTTP_204_NO_CONTENT)
def delete_all_words(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Collect word IDs before deleting UserWord records
    word_ids = [
        row.word_id
        for row in db.query(UserWord.word_id)
        .filter(UserWord.user_id == current_user.id)
        .all()
    ]

    db.query(UserWord).filter(UserWord.user_id == current_user.id).delete()
    db.commit()

    # Delete Word records that are now orphaned (no remaining UserWord references)
    if word_ids:
        still_used = {
            row.word_id
            for row in db.query(UserWord.word_id)
            .filter(UserWord.word_id.in_(word_ids))
            .all()
        }
        orphan_ids = [wid for wid in word_ids if wid not in still_used]
        if orphan_ids:
            db.query(Word).filter(Word.id.in_(orphan_ids)).delete(
                synchronize_session=False
            )
            db.commit()


@router.delete("/{word_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_word(
    word_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user_word = (
        db.query(UserWord)
        .filter(UserWord.user_id == current_user.id, UserWord.word_id == word_id)
        .first()
    )
    if not user_word:
        raise HTTPException(status_code=404, detail="Word not found")

    db.delete(user_word)
    db.commit()

    # Clean up orphaned Word record
    still_used = (
        db.query(UserWord).filter(UserWord.word_id == word_id).first()
    )
    if not still_used:
        word = db.query(Word).filter(Word.id == word_id).first()
        if word:
            db.delete(word)
            db.commit()
