from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.activity_routes import router as activity_router
from app.assets_routes import router as assets_router
from app.config import _ensure_schema_columns, cors_origins
from app.explore_routes import router as explore_router
from app.flex_routes import router as flex_router
from app.meta_routes import router as meta_router
from app.overview_routes import router as overview_router
from app.ylockers_routes import router as ylockers_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    _ensure_schema_columns()
    yield


app = FastAPI(title="yHelper API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(meta_router)
app.include_router(overview_router)
app.include_router(activity_router)
app.include_router(explore_router)
app.include_router(assets_router)
app.include_router(ylockers_router)
app.include_router(flex_router)
