from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from auth import router as auth_router
from comments import router as comments_router
from posts import router as posts_router
from uploads import router as uploads_router


BASE_DIR = Path(__file__).resolve().parent
app = FastAPI(title="Thread")
app.include_router(auth_router)
app.include_router(posts_router)
app.include_router(comments_router)
app.include_router(uploads_router)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/", include_in_schema=False)
def home() -> FileResponse:
    return FileResponse(BASE_DIR / "pages" / "index.html")


@app.get("/login", include_in_schema=False)
def login() -> FileResponse:
    return FileResponse(BASE_DIR / "pages" / "login.html")


@app.get("/register", include_in_schema=False)
def register() -> FileResponse:
    return FileResponse(BASE_DIR / "pages" / "register.html")


@app.get("/posts/{post_id}", include_in_schema=False)
def post_page(post_id: int) -> FileResponse:
    return FileResponse(BASE_DIR / "pages" / "post.html")
