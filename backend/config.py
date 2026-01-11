import os
from functools import lru_cache

class Settings:
    DATABASE_URL: str = os.getenv("DATABASE_URL", "")
    SESSION_SECRET: str = os.getenv("SESSION_SECRET", "euro-parking-secret-key")
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    
    JWT_SECRET: str = SESSION_SECRET
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRY_HOURS: int = 24
    
    UPLOAD_DIR: str = os.path.join(os.getcwd(), "uploads")
    MAX_FILE_SIZE: int = 50 * 1024 * 1024  # 50MB
    
    PORT: int = int(os.getenv("PORT", "5000"))
    
    def __init__(self):
        if not os.path.exists(self.UPLOAD_DIR):
            os.makedirs(self.UPLOAD_DIR, exist_ok=True)

@lru_cache()
def get_settings() -> Settings:
    return Settings()

settings = get_settings()
