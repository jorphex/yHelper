FROM node:24-slim AS wallet-assets
WORKDIR /wallet
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tools/walletconnect.js tools/build-wallet.mjs tools/build-scenes.mjs ./tools/
COPY site/hero.js site/boot3d.js site/nebula.js site/symbol3d.js ./site/
RUN npm run build

FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.10.4 /uv /uvx /usr/local/bin/
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY --chown=1000:1000 pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-cache
COPY --chown=1000:1000 service.py ./
COPY --chown=1000:1000 tools/recap.py ./tools/recap.py
COPY --chown=1000:1000 tools/positions.py ./tools/positions.py
COPY --chown=1000:1000 data/medians.json ./data/medians.json
COPY --chown=1000:1000 site ./site
COPY --from=wallet-assets --chown=1000:1000 /wallet/site/vendor ./site/vendor
USER 1000:1000
EXPOSE 8767
CMD ["uv", "run", "--frozen", "--no-sync", "--no-cache", "uvicorn", "service:app", "--host", "0.0.0.0", "--port", "8767", "--proxy-headers", "--forwarded-allow-ips", "*"]
