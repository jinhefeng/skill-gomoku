# 技能五子棋部署指南 (Skill Gomoku Deployment Guide)

由于增加了在线对战功能，现在项目需要作为 **Node.js 应用** 运行。

## 选项 1: 传统服务器 (Linux)

### 1. 安装 Node.js
确保服务器已安装 Node.js (推荐 v16+)。
```bash
# 检查版本
node -v
# 如果未安装，可以使用 nvm 安装
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 18
```

### 2. 上传文件
将整个 `skill-gomoku` 文件夹上传到服务器。

### 3. 安装依赖并运行
```bash
cd /path/to/skill-gomoku
npm install
npm start
```
默认运行在 **3000** 端口。

### 4. 使用 PM2 后台运行 (推荐)
为了让服务在后台稳定运行：
```bash
npm install -g pm2
pm2 start server.js --name "skill-gomoku"
pm2 save
```

### 5. 配置 Nginx 反向代理
将域名指向 3000 端口。

```nginx
server {
    listen 80;
    server_name your_domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 选项 2: Vercel / Netlify (不支持)
**注意：** 标准的 Vercel/Netlify 托管仅支持静态网站或 Serverless 函数，**不支持** 长连接的 Socket.io 服务。
如果你必须使用类似平台，推荐使用 **Render** 或 **Railway**。

## 选项 3: Render.com (免费且简单)
1.  注册 Render.com。
2.  点击 "New" -> "Web Service"。
3.  连接你的 GitHub 仓库。
4.  Build Command: `npm install`
5.  Start Command: `node server.js`
6.  点击 Deploy，几分钟后即可获得免费 HTTPS 域名。

## 常见问题
*   **无法连接服务器：** 检查防火墙是否开放了 3000 端口 (如果直接访问 IP)。
*   **一直显示“正在寻找对手”：** 可能是 WebSocket 连接失败，按 F12 查看控制台是否有红色报错。
