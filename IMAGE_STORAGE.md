# 圖片儲存設定

Epic 6 使用私有 S3 bucket 接收瀏覽器直傳，圖片透過 CloudFront 網域讀取。應用程式使用 boto3 預設 AWS 憑證鏈：本機可使用 AWS CLI profile；EC2 使用附加的 IAM Role。不要將 Access Key 寫入 `.env`。

## 環境變數

在 `.env` 設定：

```env
AWS_REGION=ap-southeast-2
S3_BUCKET=你的私有bucket名稱
CLOUDFRONT_DOMAIN=你的CloudFront網域
```

`CLOUDFRONT_DOMAIN` 可填 `d123example.cloudfront.net` 或完整的 `https://` 網址。預簽名上傳 URL 有效 5 分鐘。瀏覽器必須以回應中的 `Content-Type` header 執行 PUT。

## S3 CORS

在 S3 bucket 的 Permissions → Cross-origin resource sharing (CORS) 加入下列規則，並將正式站網域替換 `https://YOUR_APP_DOMAIN`：

```json
[
  {
    "AllowedHeaders": ["Content-Type"],
    "AllowedMethods": ["PUT", "HEAD"],
    "AllowedOrigins": ["http://localhost:8000", "https://YOUR_APP_DOMAIN"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

這是瀏覽器跨來源請求規則，不會讓 bucket 公開。bucket 應保持 Block Public Access 開啟。

## CloudFront 私有來源

建立 CloudFront distribution，S3 origin 使用 Origin Access Control (OAC) 與 SigV4 簽署請求；不要使用 S3 website endpoint。將 distribution 設為讀取私有 bucket，並只允許該 distribution 的 CloudFront service principal 讀取物件。OAC bucket policy 中的 distribution ARN 由 AWS 建立後取得，不能直接套用猜測值。將 distribution domain 設到 `CLOUDFRONT_DOMAIN`。

物件 key 使用隨機 UUID，更新圖片會得到新 key，避免舊 CDN 快取顯示舊圖片。

## 暫存物件清理

預簽名物件放在 `uploads/` 前綴；成功關聯至貼文後仍保留原 key。排程每天執行下列命令即可刪除已超過 24 小時且資料庫沒有關聯的上傳：

```powershell
uv run --env-file .env python cleanup_orphan_uploads.py
```

清理程式先讀取資料庫現有圖片關聯，再刪除未關聯且超過 24 小時的 S3 物件。排程可由 Epic 9 部署時設定。
