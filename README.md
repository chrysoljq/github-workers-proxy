# Cloudflare GitHub Proxy (Authenticated)

一个部署在 Cloudflare Workers 上的 GitHub 代理，支持密码/Token 验证，防止被恶意扫描。

## 功能特性
- **根目录代理**：直接代理 `github.com`（例如 `https://your-worker.dev/torvalds/linux`）。
- **密码保护**：访问时需输入密码或携带 Token，防止滥用和扫描。
- **Raw 内容代理**：支持 `raw.githubusercontent.com` 代理（路径前缀 `/raw-content/`）。
- **链接重写**：自动重写页面中的 GitHub 链接和重定向，确保停留在代理站内。
- **安全过滤**：屏蔽登录、设置等敏感页面（`/login`, `/settings` 等）。

## 部署方法

### 1. 部署方法 (推荐：连接 Git 仓库)
Cloudflare 现在支持直接连接 GitHub 仓库进行自动构建和部署，这是最推荐的方式，可以实现代码自动同步。

**1.1 Access Cloudflare Dashboard**
- 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
- 选择左侧菜单的 **Workers 和 Pages**
- 点击 **创建应用程序**
- 选择 **Connect to GitHub** 或者导入现有仓库

**1.2 Connect GitHub Repository**
- 如果首次使用，需要授权 Cloudflare 访问 GitHub
- 选择您 Fork 的 `github-workers-proxy` 仓库
- 所有设置保持默认即可

**1.3 Set Password**
- 部署完成后，进入 Worker 的 **Settings** -> **Variables**
- 点击 **Add Variable**（可选，默认密码为 `iloveyou`）
- Variable Name: `PROXY_PASSWORD`
- Value: (你的密码)
- 不需要重新部署，变量变更后会自动生效。

### 2. 手动部署
手动复制 `workers.js` 文件到 Cloudflare Worker 中。

## 使用说明

### 首次访问
直接访问代理域名（如 `https://gh.example.com`），会显示登录页面。输入在 `workers.js` 中配置的 `PROXY_PASSWORD` 即可进入。
登录成功后会设置 Cookie（有效期 7 天），之后也可无感访问。

### 快捷访问 (Token)
可以在 URL 后直接拼接 token 参数进行快捷登录：
`https://gh.example.com/?token=your-secret-password`

### Raw 文件
Raw 文件可以通过 `/raw-content/` 路径访问：
`https://gh.example.com/raw-content/User/Repo/branch/file.txt`

## 免责声明
- 本项目仅供学习和个人开发测试使用（如加速 Git Clone）。
- **请勿**用于登录个人账号或处理敏感数据。
- **请勿**用于非法用途。
