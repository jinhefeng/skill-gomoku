# 技能五子棋 - 生产环境部署指南

本文档提供基于 **PM2** 和 **Caddy** 的完整部署方案。

## 📋 部署前提

### 服务器要求
*   **操作系统**：Linux（推荐 Ubuntu 20.04+ / CentOS 7+）
*   **Node.js**：v14 或更高版本
*   **内存**：至少 512MB RAM
*   **端口**：需要开放 80 和 443 端口（如果使用 HTTPS）

### 准备工作
*   一台云服务器（阿里云、腾讯云、AWS 等）
*   域名（可选，但推荐用于 HTTPS）
*   SSH 访问权限

## 🚀 部署步骤

### 1. 安装 Node.js

如果服务器尚未安装 Node.js，使用以下命令安装：

**Ubuntu/Debian:**
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**CentOS/RHEL:**
```bash
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs
```

验证安装：
```bash
node -v
npm -v
```

### 2. 上传项目文件

将项目文件上传到服务器，推荐路径：`/var/www/skill-gomoku`

**方法 A：使用 Git**
```bash
cd /var/www
git clone https://github.com/yourusername/skill-gomoku.git
cd skill-gomoku
```

**方法 B：使用 SCP**
```bash
# 在本地执行
scp -r skill-gomoku/ user@your-server:/var/www/
```

### 3. 安装项目依赖

```bash
cd /var/www/skill-gomoku
npm install
```

### 4. 使用 PM2 管理进程

PM2 是推荐的 Node.js 进程管理工具，支持自动重启和开机自启。

**安装 PM2**
```bash
sudo npm install -g pm2
```

**启动应用**
```bash
pm2 start server.js --name "skill-gomoku"
```

**查看运行状态**
```bash
pm2 status
pm2 logs skill-gomoku  # 查看日志
```

**配置开机自启**
```bash
# 1. 生成启动脚本（根据提示执行输出的命令）
pm2 startup

# 2. 执行上一步输出的命令（类似如下）
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u your-user --hp /home/your-user

# 3. 保存当前进程列表
pm2 save
```

**常用 PM2 命令**
```bash
pm2 restart skill-gomoku  # 重启应用
pm2 stop skill-gomoku     # 停止应用
pm2 delete skill-gomoku   # 删除应用
pm2 monit                 # 实时监控
```

### 5. 配置反向代理（Caddy）

Caddy 会自动处理 HTTPS 证书，非常简便。

**安装 Caddy**

**Ubuntu/Debian:**
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

**CentOS/RHEL:**
```bash
yum install yum-plugin-copr
yum copr enable @caddy/caddy
yum install caddy
```

**配置 Caddyfile**

编辑 `/etc/caddy/Caddyfile`（全局配置）或使用项目中的 `Caddyfile`：

```caddy
your-domain.com {
    reverse_proxy localhost:3000
}
```

将 `your-domain.com` 替换为您的实际域名或服务器 IP。

**重载 Caddy 配置**
```bash
sudo caddy reload --config /etc/caddy/Caddyfile
```

**启用 Caddy 开机自启**
```bash
sudo systemctl enable caddy
sudo systemctl start caddy
```

### 6. 配置防火墙

确保开放必要的端口：

**使用 ufw（Ubuntu）:**
```bash
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw allow ssh       # SSH（防止被锁定）
sudo ufw enable
```

**使用 firewalld（CentOS）:**
```bash
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

### 7. 验证部署

1.  打开浏览器访问 `http://your-domain.com`
2.  如果配置了域名，Caddy 会自动申请 HTTPS 证书
3.  测试游戏功能：本地对战、在线匹配、私人房间

## 🔧 高级配置

### 自定义端口

如果需要修改默认端口（3000），编辑 `server.js` 或设置环境变量：

```bash
# 方法 1：修改 server.js
# 找到: const PORT = process.env.PORT || 3000;
# 改为: const PORT = process.env.PORT || 3001;

# 方法 2：环境变量（推荐）
pm2 start server.js --name skill-gomoku -- PORT=3001
```

### 性能优化

**增加 PM2 实例数（集群模式）:**
```bash
pm2 start server.js -i max --name skill-gomoku
```

**设置内存限制:**
```bash
pm2 start server.js --name skill-gomoku --max-memory-restart 500M
```

### 日志管理

**查看日志:**
```bash
pm2 logs skill-gomoku
pm2 logs skill-gomoku --lines 100  # 查看最近 100 行
```

**日志轮转:**
```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

## 🛡️ 安全建议

1.  **定期更新依赖**: `npm update`
2.  **使用 HTTPS**: Caddy 会自动配置
3.  **限制 SSH 访问**: 禁用 root 登录，使用 SSH 密钥
4.  **监控服务器**: 使用 PM2 监控或第三方服务
5.  **备份数据**: 定期备份 `stats.json` 等数据文件

## ❓ 故障排查

### WebSocket 连接失败
*   **检查代理配置**: Caddy 的 `reverse_proxy` 已自动处理 WebSocket 升级
*   **检查防火墙**: 确保 80/443 端口开放
*   **检查日志**: `pm2 logs skill-gomoku`

### 应用无法启动
```bash
# 检查端口占用
sudo lsof -i :3000

# 查看详细日志
pm2 logs skill-gomoku --err
```

### Caddy 无法启动
```bash
# 检查配置语法
caddy validate --config /etc/caddy/Caddyfile

# 查看 Caddy 日志
sudo journalctl -u caddy -f
```

### 性能问题
*   检查内存使用: `pm2 monit`
*   启用集群模式: `pm2 start server.js -i max`
*   优化数据库查询（如果添加了持久化）

## 📞 技术支持

如有问题，请提交 Issue 或联系维护者。

---

部署愉快！🎉
