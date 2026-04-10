from typing import List

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies import get_current_user
from ..models.tema import Tema
from ..models.user import User
from ..schemas.word import TemaBase, TemaOut

router = APIRouter(prefix="/temas", tags=["temas"])


@router.get("", response_model=List[TemaOut])
def list_temas(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(Tema).all()


@router.post("", response_model=TemaOut, status_code=status.HTTP_201_CREATED)
def create_tema(
    data: TemaBase,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tema = Tema(**data.model_dump())
    db.add(tema)
    db.commit()
    db.refresh(tema)
    return tema
