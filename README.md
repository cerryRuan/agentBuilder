# Agent Builder

桌面端工具：配置多个 Git 仓库与打包机 SSH，按映射目录勾选同步分支内容到服务器。

## 功能（MVP）

- **仓库管理**：多仓库 CRUD，并配置**构建角色**（web / h5 / java / python）
- **服务器管理**：SSH + `deploy` 目录（默认 `/home/ai_package/deploy`）
- **路径映射**：仓库 → 服务器远程目录
- **发布**：
  - **仅上传**：本机拉分支 → 覆盖远程目录
  - **上传并构建部署**：上传后在服务器执行 `build-*.sh`，再 `docker compose build/up` 对应服务
- **服务部署**：从打包机传镜像 tar 到现场机；勾选 Python 时同步 `data/python/code`
- **历史**：最近任务与日志

上传时默认排除：`.git`、`node_modules`、`dist`、`target`、`.venv` 等。

### 构建角色对应关系

| 角色 | 服务器脚本 | Compose 服务 |
|------|------------|--------------|
| web | `scripts/build-frontend.sh` | `frontend` |
| h5 | `scripts/build-h5.sh` | `frontend` |
| java | `scripts/build-java.sh` | `java-backend` |
| python | `scripts/sync-python-code.sh`（若存在）+ 镜像重建 | `python-agent` |

## 开发

```bash
cd agent-builder
npm install
npm run dev
```

## 打包 Windows 安装包

```bash
npm run dist
```

产物在 `release/`：`Agent Builder-0.1.0-Setup.exe`。

仅生成未安装的目录版（调试用）：

```bash
npm run dist:dir
```

## 推荐配置顺序

1. **Git 认证**  
2. **服务器**（含 deploy 目录）→ 测连通  
3. **仓库**（设好构建角色）+ **路径映射**  
4. 发布页选「上传并构建部署」
