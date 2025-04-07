# Cloudflare 反代 github
反代站点：`github.com`、`raw.githubcontent.com`。raw 地址会转移到你的网址子路径下(`your-domain.com/raw-content/path`)，

## 注意事项
- 网页上所有的 https://github.com, https://raw.githubcontent.com 文本会被替换为反代文本，以避免 CORS 问题
- 为了安全起步，脚本禁止了 /login、/signup 等路径
- 在网页站点添加醒目横幅，避免被举报为钓鱼网站（**未经长久测试，依然可能会被举报**）

## 一切开发旨在学习，请勿用于非法用途
- 本项目保证永久开源，欢迎提交 Issue 或者 Pull Request，但是请不要提交用于非法用途的功能。
- 如果某功能被大量运用于非法用途，那么该功能将会被移除。
- 开发人员可能在任何时间停止更新或删除项目
- 