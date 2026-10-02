# 資料模型與遷移

Epic 2 以使用者確認的 **Amazon RDS for PostgreSQL** 為資料庫引擎。模型在 `models.py`，資料庫結構由 `migrations/versions/0001_initial_schema.py` 建立。

| 資料表 | 用途 | 關鍵限制 |
|---|---|---|
| `users` | 會員 Email、顯示名稱與密碼雜湊 | 資料庫 ID 為主鍵；Email 唯一且正規化為小寫；顯示名稱為 2–30 字元；不存明文密碼 |
| `login_sessions` | 已登入的工作階段 | 僅保存隨機 Cookie 的雜湊與到期時間；登出時刪除 |
| `posts` | 貼文 | 作者參照 `users`；`deleted_at` 代表軟刪除 |
| `comments` | 留言與任意深度回覆 | `post_id` 指向貼文；`parent_id` 指向父留言；複合外鍵保證父留言屬於同一貼文 |
| `images` | 貼文或留言的 S3 object key | 必須且只能屬於一篇貼文或一則留言；每個目標的位置限 0–2 且不可重複 |
| `post_likes` | 貼文按讚 | `(post_id, user_id)` 為主鍵，一人一讚 |
| `comment_likes` | 留言按讚 | `(comment_id, user_id)` 為主鍵，一人一讚 |

貼文及留言的 `body` 可為空，以支援只有圖片的內容。建立或編輯時的「文字和圖片不能同時為空」由 API 驗證；資料庫限制文字最多 500 字元、圖片每張最多 5 MB（5,000,000 bytes）、每個目標最多 3 張。`created_at`、`updated_at` 與 `deleted_at` 使用具時區的時間欄位；後續 API 在編輯時更新 `updated_at`。

刪除貼文或留言時應設定 `deleted_at`，清空 `body`，並讓 API 隱藏圖片；節點與子留言繼續存在。被移除的 S3 圖片依 [Epic 0 決策](EPIC_0_DECISIONS.md)延後清理。

會員以 Email／密碼註冊後，由 PostgreSQL 產生使用者 ID；貼文、留言、按讚及工作階段皆參照此 ID。密碼只保存加鹽雜湊；登入使用隨機、不含個人資料的工作階段 Cookie。

首頁最新貼文使用 `posts(created_at, id)` 索引；第一層留言與任一留言的直接回覆使用 `comments(post_id, parent_id, created_at, id)` 索引。PostgreSQL 可反向掃描索引以支援新到舊排序。貼文留言數只計 `parent_id IS NULL`；留言回覆數只計該留言的直接子留言。

## 執行遷移

先準備一個 PostgreSQL 資料庫，並在終端機設定 `DATABASE_URL`。不要把真實密碼寫入檔案或提交到 Git。

```powershell
$env:DATABASE_URL = 'postgresql+psycopg://使用者:密碼@主機:5432/資料庫'
uv run alembic upgrade head
```

日後每次修改資料模型都應新增 Alembic revision。生產環境由 Secrets Manager 提供資料庫憑證，會在部署 Epic 接入；本次沒有連線或修改 AWS RDS。
