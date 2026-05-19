from dotenv import load_dotenv
from pydantic_settings import BaseSettings

# Populate os.environ from .env so non-Settings code (e.g. YOUTUBE_PROXY_URL
# read directly via os.environ.get) sees the values. Pydantic-settings alone
# only fills the Settings instance.
load_dotenv()


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./vocabox.db"
    SECRET_KEY: str = "dev-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 43200
    PORT: int = 9009

    model_config = {"env_file": ".env"}


settings = Settings()
