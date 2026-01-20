# Cloudflare GitHub Proxy (Authenticated)

一个部署在 Cloudflare Workers 上的 GitHub 代理，支持密码/Token 验证，防止被恶意扫描。

## 功能特性
- **根目录代理**：直接代理 `github.com`（例如 `https://your-worker.dev/torvalds/linux`）。
- **密码保护**：访问时需输入密码或携带 Token，防止滥用和扫描。
- **Raw 内容代理**：支持 `raw.githubusercontent.com` 代理（路径前缀 `/raw-content/`）。
- **链接重写**：自动重写页面中的 GitHub 链接和重定向，确保停留在代理站内。
- **安全过滤**：屏蔽登录、设置等敏感页面（`/login`, `/settings` 等）。

## 部署方法

### 1. 手动部署 (网页端 - 推荐)
最简单的方式，无需安装任何工具。
1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
2. 进入 **Workers & Pages** -> **Create Application** -> **Create Worker**。
3. 随意命名并点击 **Deploy** (先部署个空壳)。
4. 点击 **Edit code** 进入代码编辑器。
5. 将仓库中的 `workers.js` 代码**全部复制粘贴**覆盖原有代码。
6. **修改密码**：在编辑器中找到 `const PROXY_PASSWORD = 'your-secret-password';`，将密码改为你自己设定的密码。
7. 点击右上角 **Deploy** 保存。

### 2. 使用 Wrangler (命令行)
配置了 `wrangler.toml` 后也可使用 CLI 部署：

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
