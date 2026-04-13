from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.activity_routes import router as activity_router
from app.assets_routes import router as assets_router
from app.config import _ensure_schema_columns, cors_origins
from app.explore_routes import router as explore_router
from app.meta_routes import router as meta_router
from app.overview_routes import router as overview_router
from app.regimes_routes import router as regimes_router
from app.trends_routes import router as trends_router

app = FastAPI(title="yHelper API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _on_startup() -> None:
    _ensure_schema_columns()


app.include_router(meta_router)
app.include_router(overview_router)
app.include_router(activity_router)
app.include_router(explore_router)
app.include_router(regimes_router)
app.include_router(trends_router)
app.include_router(assets_router)
