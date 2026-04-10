from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..dependencies import get_current_user
from ..models.user import User
from ..models.user_word import UserWord
from ..models.word import Word
from ..schemas.word import UserWordOut, WordCreate, WordOut

router = APIRouter(prefix="/words", tags=["words"])


@router.get("", response_model=List[WordOut])
def list_words(
    skip: int = 0,
    limit: int = 100,
    tema_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Word).options(joinedload(Word.tema))
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
    word = Word(**data.model_dump())
    db.add(word)
    db.flush()  # get word.id without full commit

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


@router.delete("/{word_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_word(
    word_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    word = db.query(Word).filter(Word.id == word_id).first()
    if not word:
        raise HTTPException(status_code=404, detail="Word not found")
    db.delete(word)
    db.commit()
