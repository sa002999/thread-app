FROM node:24-alpine AS assets
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY static/input.css static/input.css
COPY static/*.html static/
COPY pages pages
RUN npm run build

FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py ./
COPY models.py users.py database.py auth.py storage.py uploads.py posts.py comments.py media.py alembic.ini ./
COPY migrations migrations
COPY pages pages
COPY entrypoint.sh ./
COPY --from=assets /app/static/styles.css static/styles.css
COPY static static
EXPOSE 8000
CMD ["sh", "./entrypoint.sh"]
