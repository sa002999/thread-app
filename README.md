# Thread

Threads 風格貼文與留言串 Web App。會員以 PostgreSQL 的 `users` 資料表註冊／登入，支援貼文、圖片、巢狀留言與按讚。

## 本機啟動

需求：Python 3.13、[uv](https://docs.astral.sh/uv/)、Node.js 24 與 npm。

```powershell
uv sync
npm ci
npm run build
Copy-Item .env.example .env
# 編輯 .env：填入 DATABASE_URL，並將 COOKIE_SECURE 設為 0（僅本機 HTTP）
uv run --env-file .env alembic upgrade head
uv run --env-file .env uvicorn main:app --reload
```

開啟 `http://localhost:8000/`；`/health` 回傳服務狀態。`COOKIE_SECURE=0` 僅供本機 HTTP 開發；正式環境須使用 HTTPS 並保留 `COOKIE_SECURE=1`。修改頁面 Tailwind class 時，重新執行 `npm run build`；也可以另開終端執行 `npm run watch`。

## Docker 啟動

```powershell
docker build -t thread-app .
docker run --rm -p 8000:8000 --env-file .env thread-app
```

Docker 建置時會編譯 Tailwind CSS。`.env` 不會被複製進映像；本機 Docker 連線的資料庫主機須可從容器存取。Font Awesome 圖示目前透過公開 CDN 載入，瀏覽器需要網路連線。

## 設定

`.env.example` 列出 S3、CloudFront、Secrets Manager、資料庫連線及 Cookie 設定名稱。`.env` 已由 Git 和 Docker 建置忽略；`uv run --env-file .env` 會將值提供給 Alembic 與應用程式。EC2 可不設定 `DATABASE_URL`，改提供 `DATABASE_SECRET_ID` 與 `AWS_REGION`；應用程式透過 EC2 IAM Role 讀取 Secret，啟動時先套用 Alembic migration，再啟動 FastAPI。正式網域應設定 `PUBLIC_ORIGIN` 並使用 HTTPS。AWS 基礎設定與 EC2 部署步驟見 [Epic 9 部署指南](DEPLOYMENT.md)。

第一版提供 Email／密碼註冊、登入與登出；不提供密碼重設。密碼只儲存加鹽雜湊，登入工作階段保存在資料庫，瀏覽器只取得 HttpOnly Cookie。登入者可呼叫 `/api/auth/me` 取得自己的 ID、顯示名稱與防跨站請求權杖；後續修改內容的 API 應使用 `current_account` 依賴驗證身分與權杖。

資料庫採 PostgreSQL，資料表與遷移指令見 [資料模型與遷移](DATA_MODEL.md)。

圖片 S3 與 CloudFront 設定、CORS 及孤兒圖片清理方式見 [圖片儲存設定](IMAGE_STORAGE.md)。

規格與工作拆分見 [需求規格書](REQUIREMENTS.md)及 [Epics 與 Tickets](EPICS_AND_TICKETS.md)。
