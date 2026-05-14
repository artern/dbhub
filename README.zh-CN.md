> [!NOTE]
> DBHub 由 [Bytebase](https://www.bytebase.com/) 开发，一款开源数据库 DevSecOps 平台。

> [!IMPORTANT]
> 本项目是 [bytebase/dbhub](https://github.com/bytebase/dbhub) 的 Fork，由 [artern/dbhub](https://github.com/artern/dbhub) 维护，发布至 npm 的包名为 `@artern/dbhub`，MCP 注册名为 `io.github.artern/dbhub`。
>
> **支持达梦数据库（DMDB）** 是本 Fork 的主要新增功能。连接达梦数据库需要安装 [`dmdb`](https://www.npmjs.com/package/dmdb) npm 包，该包使用达梦自有的专有许可证，**不适用**本项目的 MIT 许可证，请在使用前单独安装并阅读其许可条款：
> ```bash
> npm install dmdb
> ```

<p align="center">
<a href="https://dbhub.ai/" target="_blank">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/artern/dbhub/main/docs/images/logo/full-dark.svg" width="75%">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/artern/dbhub/main/docs/images/logo/full-light.svg" width="75%">
  <img src="https://raw.githubusercontent.com/artern/dbhub/main/docs/images/logo/full-light.svg" width="75%" alt="DBHub Logo">
</picture>
</a>
</p>

```bash
            +------------------+    +--------------+    +------------------+
            |                  |    |              |    |                  |
            |  Claude Desktop  +--->+              +--->+    PostgreSQL    |
            |                  |    |              |    |                  |
            |  Claude Code     +--->+              +--->+    SQL Server    |
            |                  |    |              |    |                  |
            |  Cursor          +--->+    DBHub     +--->+    SQLite        |
            |                  |    |              |    |                  |
            |  VS Code         +--->+              +--->+    MySQL         |
            |                  |    |              |    |                  |
            |  Copilot CLI     +--->+              +--->+    MariaDB       |
            |                  |    |              |    |                  |
            |                  |    |              +--->+    达梦 (DMDB)   |
            +------------------+    +--------------+    +------------------+
                 MCP 客户端           MCP 服务器              数据库
```

DBHub 是一个零依赖、Token 高效的 MCP 服务器，实现了 Model Context Protocol (MCP) 服务器接口。这个轻量级网关让 MCP 兼容客户端能够连接和探索各种数据库：

- **本地开发优先**：零依赖，仅两个 MCP 工具，Token 高效，最大化上下文窗口利用率
- **多数据库支持**：通过单一接口连接 PostgreSQL、MySQL、MariaDB、SQL Server、SQLite 和达梦（DMDB）
- **多连接管理**：通过 TOML 配置同时连接多个数据库
- **安全防护**：只读模式、行数限制、查询超时，防止失控操作
- **安全访问**：支持 SSH 隧道和 SSL/TLS 加密

## 支持的数据库

PostgreSQL、MySQL、SQL Server、MariaDB、SQLite、达梦（DMDB）。

## MCP 工具

DBHub 提供以下 MCP 工具：

- **[execute_sql](https://dbhub.ai/tools/execute-sql)**：执行 SQL 查询，支持事务和安全控制
- **[search_objects](https://dbhub.ai/tools/search-objects)**：搜索和浏览数据库 Schema、表、列、索引和存储过程，支持渐进式信息展示
- **[自定义工具](https://dbhub.ai/tools/custom-tools)**：在 `dbhub.toml` 配置文件中定义可复用的参数化 SQL 操作

## 工作台

DBHub 内置 [Web 工作台](https://dbhub.ai/workbench/overview)，无需 MCP 客户端即可可视化执行查询、运行自定义工具和查看请求追踪。

![workbench](https://raw.githubusercontent.com/artern/dbhub/main/docs/images/workbench/workbench.webp)

## 安装

详见完整的[安装指南](https://dbhub.ai/installation)。

### 快速开始

**Docker：**

```bash
docker run --rm --init \
   --name dbhub \
   --publish 8080:8080 \
   artern/dbhub \
   --transport http \
   --port 8080 \
   --dsn "postgres://user:password@localhost:5432/dbname?sslmode=disable"
```

**NPM：**

```bash
npx @artern/dbhub@latest --transport http --port 8080 --dsn "postgres://user:password@localhost:5432/dbname?sslmode=disable"
```

**演示模式：**

```bash
npx @artern/dbhub@latest --transport http --port 8080 --demo
```

所有可用参数请参见[命令行选项](https://dbhub.ai/config/command-line)。

### 达梦数据库连接

连接达梦数据库需先单独安装驱动（达梦专有许可证）：

```bash
npm install dmdb
```

DSN 格式：

```
dm://用户名:密码@主机:端口/数据库名
```

示例：

```bash
npx @artern/dbhub@latest --transport http --port 8080 --dsn "dm://SYSDBA:password@localhost:5236/MYDB"
```

### 多数据库配置

通过 TOML 配置文件同时连接多个数据库，适合在单个 DBHub 实例中管理生产、预发布和开发环境。

```toml
[[sources]]
id = "pg_prod"
dsn = "postgres://user:pass@localhost:5432/production"

[[sources]]
id = "dm_local"
dsn = "dm://SYSDBA:password@localhost:5236/MYDB"
```

详见[多数据库配置文档](https://dbhub.ai/config/toml)。

## 本地开发

```bash
# 安装依赖
pnpm install

# 开发模式运行
pnpm dev

# 构建并运行生产版本
pnpm build && pnpm start --transport stdio --dsn "postgres://user:password@localhost:5432/dbname"
```

参见[测试](.claude/skills/testing/SKILL.md)和[调试](https://dbhub.ai/config/debug)文档。

## 贡献者

<a href="https://github.com/artern/dbhub/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=artern/dbhub" />
</a>

## Star 历史

<a href="https://www.star-history.com/?repos=artern%2Fdbhub&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=artern/dbhub&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=artern/dbhub&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=artern/dbhub&type=date&legend=top-left" />
 </picture>
</a>

## 许可证

本项目使用 [MIT 许可证](./LICENSE)。

- 原始版权：Copyright (c) 2025 Bytebase
- Fork 版权：Copyright (c) 2026 artern（达梦/DMDB 支持）
- `dmdb` npm 包使用达梦数据库专有许可证，独立于本项目 MIT 许可证。
