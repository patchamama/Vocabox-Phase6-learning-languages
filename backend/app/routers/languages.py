from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies import get_current_user
from ..models.language_dict import LanguageDict
from ..models.user import User

router = APIRouter(prefix="/languages", tags=["languages"])


class LanguageOut(BaseModel):
    code: str
    name_es: Optional[str] = None
    name_en: Optional[str] = None

    model_config = {"from_attributes": True}


@router.get("", response_model=List[LanguageOut])
def list_languages(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(LanguageDict).order_by(LanguageDict.name_es).all()
