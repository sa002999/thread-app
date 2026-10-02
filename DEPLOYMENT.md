# Epic 9：AWS 部署

本文件使用 **GitHub → EC2 clone → EC2 建置 Docker image → 啟動 container**。這種方式不需要 ECR，適合目前的單一 EC2 手動部署。請選擇 `ap-southeast-2`；你的 RDS、S3 bucket 與 CloudFront 設定已使用這個 region。RDS 保持私有，EC2 與 RDS 放在同一個 VPC。AWS 官方 Console 可從 RDS 資料庫的 **Actions → Set up EC2 connection** 建立 EC2 到 RDS 的安全群組規則：[連線說明](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/ec2-rds-connect.html)。

## 1. 在 Secrets Manager 建立資料庫 Secret

1. AWS Console 切到 **Asia Pacific (Sydney) / ap-southeast-2**。
2. 開啟 **Secrets Manager → Store a new secret**，選 **Other type of secret**。
3. 儲存為 JSON，使用目前 RDS 的資料庫帳號填入以下欄位。密碼只填在 AWS Console，不要貼到聊天、文件、映像或 Git。

   ```json
   {
     "username": "資料庫使用者",
     "password": "資料庫密碼",
     "host": "database-1.cxswssuiancr.ap-southeast-2.rds.amazonaws.com",
     "port": 5432,
     "dbname": "postgres"
   }
   ```

4. Secret name 設為 `wehelp/stage3/database`。儲存後複製 Secret ARN；稍後會放入 EC2 的 `DATABASE_SECRET_ID`。

## 2. 建立 EC2 IAM Role

到 **IAM → Roles → Create role → AWS service → EC2**。建立角色 `thread-ec2-role`，附加 `AmazonSSMManagedInstanceCore`，讓你可用 Systems Manager Session Manager 進入主機，不必開 SSH。再建立下列 inline permission policy，替換帳號 ID 與 bucket 名稱。Secret ARN 後綴要保留萬用字元 `-*`。

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadDatabaseSecret",
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:ap-southeast-2:ACCOUNT_ID:secret:wehelp/stage3/database-*"
    },
    {
      "Sid": "ApplicationImageAccess",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::YOUR_BUCKET/uploads/*"
    },
    {
      "Sid": "CleanupUploadListing",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::YOUR_BUCKET",
      "Condition": {"StringLike": {"s3:prefix": "uploads/*"}}
    }
  ]
}
```

若 Secret 使用客戶自管 KMS key，Role 還需該 key 的 `kms:Decrypt`；AWS 管理的 `aws/secretsmanager` key 不需額外加入。不要把 IAM Access Key 放在 EC2、Docker image 或 `.env`；boto3 會透過 EC2 Role 取得短期憑證。[Secrets Manager 權限說明](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html)。

## 3. 建立 EC2 並開通網路

1. 在 EC2 Console 建立 Amazon Linux 2023 instance，region 選 Sydney、VPC 選 RDS 所在 VPC，IAM instance profile 選 `thread-ec2-role`。EC2 需要 HTTPS 出站以連 GitHub、讀取套件與存取 AWS API。
2. 暫時驗收網站時，建立 EC2 security group inbound：TCP `8000`，來源選你的目前 IP（My IP）；不要使用 `0.0.0.0/0`。不要新增公開的 PostgreSQL `5432` 規則。
3. 在 RDS 的 **Connectivity & security → VPC security groups**，新增 inbound PostgreSQL `5432`，來源選 EC2 的 security group。保留既有本機 IP 規則，之後不需由 EC2 對公網開放 RDS。
4. EC2 應在有對外連線能力的 subnet。Session Manager 若尚未連線，先確認 instance profile、SSM agent、DNS、HTTPS 出站及 VPC/NAT 設定。

## 4. 推送程式至 GitHub，並在 EC2 建置 image

先在開發電腦確認 `.env` 已被 Git 忽略，且只提交 `.env.example`，不要將資料庫密碼、AWS 憑證或其他正式環境 secret 推送到 GitHub：

```bash
git check-ignore .env
git status --short
```

`git check-ignore .env` 應列出 `.env`；檢查待提交檔案沒有 `.env` 或其他憑證後，再將程式提交並推送至 GitHub。若 `.env` 曾經提交過，即使後續刪除，仍可能留在 Git 歷史中，應先輪替其中的憑證。

使用 **EC2 → Instances → Connect → Session Manager** 開啟 shell，安裝 Git 與 Docker：

```bash
sudo dnf install -y git docker
sudo systemctl enable --now docker
```

公開 repository 可直接 clone：

```bash
git clone https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git
cd YOUR_REPOSITORY
sudo docker build -t thread-app:epic9 .
```

私有 repository 請用 repository 專屬、唯讀的 SSH deploy key，不要把 GitHub 密碼或長效 token 放入 clone URL、shell history 或 image：

```bash
ssh-keygen -t ed25519 -C "thread-ec2-readonly" -f ~/.ssh/thread_github -N ""
cat ~/.ssh/thread_github.pub
```

將顯示的 `.pub` 公鑰加入 GitHub repository **Settings → Deploy keys**，保持唯讀。接著在 EC2 建立 SSH 設定：

```bash
cat > ~/.ssh/config <<'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/thread_github
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config ~/.ssh/thread_github
ssh -T git@github.com
```

完成 GitHub 主機指紋確認後，clone 並建置：

```bash
git clone git@github.com:YOUR_ACCOUNT/YOUR_REPOSITORY.git
cd YOUR_REPOSITORY
sudo docker build -t thread-app:epic9 .
```

`.dockerignore` 會排除 `.env`、`.git` 等檔案。私有 repository 的 deploy key 僅提供 EC2 讀取 GitHub 原始碼的權限；AWS IAM Role 負責存取 Secrets Manager 與 S3，兩者用途不同。Docker build 需要 EC2 對外 HTTPS 連線以下載 Node、Python 套件。直接在 EC2 建置適合目前單一主機手動部署；每次更新要在 EC2 手動 `git pull`、重建 image 並重啟 container，替換 container 時會有短暫中斷。之後若要自動部署或縮短中斷時間，再考慮 GitHub Actions 或 ECR。

## 5. 在 EC2 啟動容器

在啟動指令填入 Secret ARN、bucket、CloudFront domain 及 EC2 公網 IPv4。先用受限來源 IP 做 HTTP 暫時驗收時，`COOKIE_SECURE=0`；正式提供登入前，必須先設定 HTTPS，再改回 `COOKIE_SECURE=1` 並更新 `PUBLIC_ORIGIN`。

若正在更新已運行的 container，先停止並移除舊 container（RDS 和 S3 資料不會因此刪除）：

```bash
sudo docker stop thread-app
sudo docker rm thread-app
```

建立 container：

```bash
sudo docker run -d --name thread-app --restart unless-stopped -p 8000:8000 \
  -e AWS_REGION=ap-southeast-2 \
  -e DATABASE_SECRET_ID='你的 Secret ARN' \
  -e DATABASE_SSLMODE=require \
  -e DATABASE_URL= \
  -e S3_BUCKET='你的 bucket 名稱' \
  -e CLOUDFRONT_DOMAIN='你的 CloudFront domain' \
  -e COOKIE_SECURE=0 \
  -e PUBLIC_ORIGIN='http://EC2公網IPv4:8000' \
  thread-app:epic9
```

Container entrypoint 會先執行 `alembic upgrade head`，再啟動 FastAPI。查看啟動狀態：

```bash
sudo docker logs thread-app
```

瀏覽器到 `http://EC2公網IPv4:8000/`，並以 `/health` 確認服務。S3 bucket CORS 的 `AllowedOrigins` 也要加入這個完整來源（包括 `:8000`）；保留 `http://localhost:8000` 供本機開發。CloudFront OAC 的 bucket policy 不需增加公開讀取規則；EC2 的 S3 存取由上面的 Role identity policy 授權。

正式 HTTPS 可在後續設定自有網域及 TLS，並將 `PUBLIC_ORIGIN` 設為 `https://你的網域`、`COOKIE_SECURE=1`，S3 CORS 也加上正式 HTTPS 網域。

## 常見錯誤

- `AccessDenied` / Secrets Manager：檢查 Role 是否附加到 EC2、Secret ARN 是否在 policy 範圍、region 是否一致；若用 customer-managed KMS key，檢查 `kms:Decrypt`。
- RDS 連線 timeout：檢查 EC2 與 RDS 同 VPC、RDS inbound `5432` 的來源為 EC2 security group，並確認 RDS endpoint、port 和 VPC routing。
- `DATABASE_URL is required`：部署指令需將 `DATABASE_URL` 留空，並提供 `DATABASE_SECRET_ID`、`AWS_REGION`。
- S3 上傳 CORS 錯誤：S3 CORS `AllowedOrigins` 必須和瀏覽器網址的 scheme、host、port 完全相同。

AWS 官方 RDS 安全群組與連線文件：[自動設定 EC2 到 RDS 連線](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/ec2-rds-connect.html)、[EC2/RDS 安全群組教學](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/tutorial-connect-ec2-instance-to-rds-database.html)。
