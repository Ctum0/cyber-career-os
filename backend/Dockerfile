# Cyber Career OS backend — runs as ONE always-on instance.
# SQLite (data/cybercareer.db) and the in-process scheduler (app/main.py
# lifespan) must live on a single long-lived container — never serverless.
FROM python:3.13-slim

WORKDIR /app

# All dependencies (incl. Pillow and python-frontmatter) come from
# requirements.txt and install as prebuilt wheels on slim — no build tools
# or system packages needed.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

# Non-root runtime user. /app/data (SQLite database + WAL files) must be
# writable by it; ownership is baked in here so the `backend-data` named
# volume in docker-compose.yml inherits it on first mount.
RUN useradd --uid 1000 --user-group --create-home --home-dir /home/appuser appuser \
    && install -d -o appuser -g appuser /app/data
USER appuser

EXPOSE 8000
# --workers 1 is deliberate: more workers = duplicate in-process schedulers
# (app/main.py lifespan) and racing init_db migrations.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
