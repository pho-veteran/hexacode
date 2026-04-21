FROM python:3.12-slim

WORKDIR /app

COPY hexacode-backend/services/problem-service/pyproject.toml ./pyproject.toml
COPY hexacode-backend/services/problem-service/app ./app
COPY hexacode-backend/backend_common ./backend_common
COPY hexacode-backend/db ./db
COPY scripts/import_problem_catalog.py ./scripts/import_problem_catalog.py

RUN pip install --no-cache-dir .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
