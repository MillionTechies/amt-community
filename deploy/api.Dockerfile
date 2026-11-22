# The Community API (Django + gunicorn). Also runs the worker (run_worker).
# Built by deploy/docker-compose.yml with the repo root as context.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY backend/requirements.txt .
RUN pip install -r requirements.txt

COPY backend/ .
# Static files for the admin and the API docs, served by WhiteNoise. The key is only
# needed to load the settings here; the real one comes from deploy/.env at run time.
RUN DJANGO_SECRET_KEY=build-only python manage.py collectstatic --noinput \
    && useradd --uid 1000 --no-create-home app \
    && mkdir -p media && chown app media

USER app
EXPOSE 8000
CMD ["gunicorn", "config.wsgi", "--bind", "0.0.0.0:8000", "--workers", "3", "--access-logfile", "-"]
