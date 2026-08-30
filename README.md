<p align="center">
  <img src="public/icon.svg" width="96" height="96" alt="LANFlow logo">
</p>

<h1 align="center">LANFlow</h1>

<p align="center">
  无需账号、无需云端，在同一 Wi-Fi 或手机热点内自然地浏览、共享与传输文件。
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-0.6.3-f4b942">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white">
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%20%7C%20Browser-102a43">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-2a9d8f">
</p>

---

LANFlow 是一个 local-first 局域网文件中心。只需在一台 Windows 电脑上启动服务，手机、平板或其他电脑即可通过浏览器扫码接入。文件在局域网内传输，不经过第三方云存储。

> [!IMPORTANT]
> LANFlow 当前使用局域网 HTTP 传输，不提供端到端加密。请仅在可信的家庭、办公或个人热点网络中使用，并按需启用访问口令。

## 功能亮点

| 能力 | 说明 |
| --- | --- |
| 零安装访问 | 其他设备只需要浏览器，扫描页面二维码即可加入 |
| 快速发送 | 定向发送给在线设备、广播给所有设备，或直接保存到主机收件箱 |
| 主机收件箱 | 文件永久保存到电脑的 `data/inbox`，可预览、保存或一键打开目录 |
| 共享空间 | 浏览目录、进入子目录、预览和下载文件 |
| 外部文件夹 | Windows 主机可直接选择多个现有文件夹共享，无需复制到项目目录 |
| 多格式预览 | 图片、视频、音频、PDF 与文本；图片会完整等比例适配屏幕 |
| 移动端选择器 | “发送文件”后再选择文件管理器或相册，适配 Android 系统选择器 |
| 可靠传输 | 流式写盘、多文件上传、实时进度、重名自动处理、HTTP Range |
| 在线发现 | SSE 实时状态配合 8 秒心跳回退，降低移动浏览器后台断连影响 |
| 可选口令 | 可在电脑页面设置或关闭访问口令；口令使用 scrypt 加盐派生值保存 |
| 自动断开 | 默认启动 1 小时后停止，可选 30 分钟、1/2/4 小时或永不停止 |
| 双击运行 | Windows x64 便携包内置 Node.js，无需安装 npm 或开发环境 |

## 工作方式

```text
手机 / 平板 / 其他电脑
          │
          │  同一 Wi-Fi、路由器或个人热点
          ▼
┌──────────────────────────────┐
│        LANFlow 主机          │
│                              │
│  data/shared     长期共享    │
│  data/inbox      永久收件    │
│  data/transfers  临时闪传    │
└──────────────────────────────┘
```

LANFlow 采用“局域网主机中转 + 浏览器客户端”架构。它不依赖公网发现服务，接收方短暂离线时，发往主机收件箱的文件仍可可靠保存。

## 快速开始

### Windows 便携版

1. 从 [Releases](../../releases/latest) 下载最新的 `LANFlow Windows x64.zip`。
2. 解压完整文件夹。
3. 双击 `启动 LANFlow.cmd`。
4. Windows 防火墙询问时，仅允许“专用网络”。
5. 在手机或其他电脑上扫描网页中的二维码。

便携版不需要安装 Node.js。黑色窗口是本地服务进程；可以通过电脑网页右上角的“结束服务”正常关闭。

### 从源码运行

要求：

- Node.js 20 或更新版本
- npm、pnpm 或其他兼容的包管理器

```bash
git clone https://github.com/shuipashui/LANFlow.git
cd LANFlow
npm install
npm start
```

默认监听：

```text
http://localhost:4173
```

终端会同时显示可供局域网设备访问的 Network 地址。

## 使用指南

### 闪传文件

1. 在“闪传”中选择接收位置。
2. 电脑可点击或拖入任意文件。
3. 手机点击“发送文件”，再选择“文件管理器”或“相册”。
4. 上传完成后，接收设备的“接收记录”会立即更新。

发往“主机 · 收件箱”的文件会直接写入 `data/inbox`，即使主机没有打开网页也能接收。

### 使用共享空间

共享空间提供两种来源：

- 把长期共享的文件放入 `data/shared`。
- 在主机电脑点击“添加共享文件夹”，直接共享文件原位置。

外部共享文件夹不会被复制。点击已共享文件夹旁的“×”只会取消共享，不会删除原文件。

### 文件保留规则

| 类型 | 位置 | 默认保留时间 |
| --- | --- | --- |
| 主机收件箱 | `data/inbox` | 永久，直到手动删除 |
| 共享空间 | `data/shared` 或外部文件夹 | 永久 |
| 临时闪传 | `data/transfers` | 24 小时 |

### 访问口令

在主机页面右上角打开“访问设置”：

- 设置至少 4 位的访问口令；
- 修改现有口令；
- 关闭访问口令；
- 配置自动断开时间。

访问口令不会明文写入设置文件。通过环境变量设置的口令优先级更高，且不能在网页中修改。

## 配置

LANFlow 可通过环境变量配置：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `4173` | HTTP 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `LANFLOW_NAME` | 电脑主机名 | 页面显示的主机名称 |
| `LANFLOW_ACCESS_CODE` | 空 | 局域网访问口令 |
| `LANFLOW_DATA_DIR` | `data` | 数据根目录 |
| `LANFLOW_SHARED_DIR` | `data/shared` | 内置共享目录 |
| `LANFLOW_INBOX_DIR` | `data/inbox` | 主机收件目录 |
| `LANFLOW_TRANSFER_DIR` | `data/transfers` | 临时闪传目录 |
| `LANFLOW_MAX_UPLOAD_BYTES` | 20 GiB | 单文件上传上限 |
| `LANFLOW_TRANSFER_TTL_MS` | 24 小时 | 临时闪传保留时间 |
| `LANFLOW_OPEN_BROWSER` | 便携版为 `1` | 启动后自动打开浏览器 |

PowerShell 示例：

```powershell
$env:LANFLOW_ACCESS_CODE = "2468"
$env:LANFLOW_SHARED_DIR = "D:\Shared"
$env:PORT = "8080"
npm start
```

旧版 `LANTERN_*` 环境变量仍保留兼容支持，但新部署建议使用 `LANFLOW_*`。

## 项目结构

```text
LANFlow/
├─ public/                  # 浏览器界面、PWA 与静态资源
├─ src/
│  └─ server.js            # HTTP、SSE、上传、预览与安全边界
├─ scripts/
│  ├─ build-portable.ps1   # Windows x64 便携包构建
│  └─ portable-launcher.cmd
├─ test/                    # Node.js 测试
├─ data/                    # 运行数据，不提交到 Git
├─ docs/                    # 产品与设计文档
└─ README.md
```

## 开发与测试

```bash
npm install
npm run dev
```

运行测试：

```bash
npm test
```

构建 Windows x64 便携包：

```powershell
.\scripts\build-portable.ps1
```

构建结果位于：

```text
dist/LANFlow 0.6.3 Windows x64/
dist/LANFlow 0.6.3 Windows x64.zip
```

## 安全模型

LANFlow 已实现：

- 共享根目录边界检查；
- 路径穿越防护；
- 符号链接越界防护；
- 可选访问口令与 HttpOnly 会话 Cookie；
- scrypt 加盐口令派生；
- 单文件大小限制；
- 只有主机电脑能选择共享目录、打开收件箱、修改设置或结束服务；
- 默认 1 小时自动停止服务。

当前限制：

- HTTP 流量未加密；
- 同一局域网内的恶意设备仍可能进行流量监听；
- 外部共享文件夹应只选择确实希望公开给当前局域网的内容；
- 公共 Wi-Fi、校园网和酒店网络不建议直接开放。

发现安全问题时，请不要公开包含敏感信息的 Issue；建议通过仓库维护者提供的私密联系方式报告。

## 浏览器兼容性

建议使用较新的 Chrome、Edge、Firefox 或 Safari。

- Android 的文件来源列表由系统和浏览器共同决定。LANFlow 将“文件管理器”限制为 `application/*`，并将图片/视频单独交给相册入口。
- iOS/iPadOS 会使用系统文件或照片选择器。
- PWA 可安装，但服务仍必须由主机电脑运行。

## 路线图

- [ ] 文件夹打包为 ZIP 下载
- [ ] 上传暂停、续传和 SHA-256 完整性校验
- [ ] 传输历史持久化与清理管理
- [ ] 桌面托盘、开机启动和系统右键发送
- [ ] mDNS/UDP 主机发现
- [ ] 一次性分享链接与细粒度只读权限
- [ ] 可选 WebRTC 直传通道

## 设计参考

LANFlow 是独立实现，产品设计参考了以下成熟项目：

- [LocalSend](https://github.com/localsend/localsend)：本地优先、无账号与跨平台传输体验
- [PairDrop](https://github.com/schlagmichdoch/PairDrop)：浏览器零安装与在线设备交互
- [File Browser](https://github.com/filebrowser/filebrowser)：共享目录、文件浏览与权限边界

本项目没有复制上述项目的源代码。

## 贡献

欢迎提交 Issue 和 Pull Request。

提交代码前请：

1. 保持改动范围清晰；
2. 为安全边界和路径处理补充测试；
3. 运行 `npm test`；
4. 不要提交 `data/`、`dist/`、访问口令或个人文件。

## 许可证

LANFlow 使用 [MIT License](LICENSE)。
