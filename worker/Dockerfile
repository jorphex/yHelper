FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY yhelper_shared ./yhelper_shared
COPY worker/worker ./worker

CMD ["python", "-m", "worker.main"]

