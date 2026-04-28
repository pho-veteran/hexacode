FROM python:3.12-slim

WORKDIR /app

COPY services/problem-service/pyproject.toml ./pyproject.toml
COPY services/problem-service/app ./app
COPY backend_common ./backend_common
COPY db ./db
COPY scripts/import_problem_catalog.py ./scripts/import_problem_catalog.py

RUN pip install --no-cache-dir .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
