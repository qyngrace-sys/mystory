# 嗅嗅剧场 Android 离线 APK + 热更新

本项目使用 **Capacitor** 将网页资源内置到 APK，并通过 **CapGo OTA** 从 GitHub Pages 拉取热更新包。

## 架构说明

```
APK 内置 www/（离线可用）
    ↓ 启动时联网
读取 ota-update.json（GitHub Pages）
    ↓ 若 version 更高
下载 ota-bundle.zip → 替换 Web 资源 → 自动重启
    ↓ 无更新或离线
使用内置 / 已缓存版本继续运行
```

- **离线**：界面、样式、脚本、字体均打包在 APK 内，无需打开网址。
- **热更新**：改网页后生成 OTA 包上传到 GitHub，用户下次打开 App 自动更新。
- **AI / 生图 API**：仍需要网络（与网页版相同）。

## 环境准备

1. **Node.js** 18+
2. **Android Studio**（含 Android SDK）
3. **JDK 17**（Android Studio 自带即可）

安装依赖：

```bash
npm install
```

## 第一次打包 APK

```bash
# 1. 同步网页到 www/ 并编译启动脚本
npm run build:web

# 2. 同步到 Android 工程
npx cap sync android

# 3. 用 Android Studio 打开并构建
npm run cap:open
```

在 Android Studio 中：**Build → Build Bundle(s) / APK(s) → Build APK(s)**

Debug APK 输出路径：

```
android/app/build/outputs/apk/debug/app-debug.apk
```

命令行构建（需配置 JAVA_HOME）：

```bash
npm run android:debug
```

## 发布热更新（无需重装 APK）

每次改完 `app.js` / `styles.css` / `index.html` 后：

### 1. 提高网页版本号

编辑根目录 `index.html`，递增 `app.js` 的版本戳，例如：

```html
<script src="app.js?v=163"></script>
```

### 2. 构建 OTA 包

```bash
npm run build:web
npm run build:ota
```

会生成：

| 文件 | 用途 |
|------|------|
| `dist/ota-bundle.zip` | 热更新资源包 |
| `ota-update.json` | 更新清单（含 version、url、checksum） |

### 3. 上传到 GitHub Pages

将以下两个文件放到 **mystory 仓库根目录**（与 `index.html` 同级）：

- `ota-bundle.zip`
- `ota-update.json`

推送后，已安装 APK 的用户**下次打开 App** 时会自动检测并下载更新。

### ota-update.json 示例

```json
{
  "version": "163",
  "url": "https://qyngrace-sys.github.io/mystory/ota-bundle.zip",
  "checksum": "…",
  "minAppVersion": "1.0.0",
  "message": "嗅嗅剧场网页更新 v163"
}
```

`version` 必须大于用户当前内置/已更新版本（与 `app.js?v=` 数字一致）。

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run build:web` | 同步 www + 编译 capacitor-app.js |
| `npm run build:ota` | 生成 OTA zip 与清单 |
| `npm run cap:sync` | build:web 后同步 Android |
| `npm run cap:open` | 用 Android Studio 打开工程 |
| `npm run android:debug` | 命令行打 Debug APK |

## 目录说明

```
play/
├── www/                 # 构建产物（Capacitor webDir，勿手改）
├── capacitor/main.js    # OTA 启动逻辑源码
├── scripts/
│   ├── sync-www.js      # 复制资源、离线字体、注入启动页
│   └── build-ota-bundle.js
├── android/             # Android 工程
├── dist/                # OTA 输出目录
└── ota-update.json      # 最新清单（上传用）
```

## 注意事项

1. **GitHub Pages 网页版**仍使用根目录 `index.html`（带 CDN 字体）；**APK 专用** `www/index.html` 由 `sync-www.js` 自动生成（本地字体、OTA 启动页）。
2. **未打包** `vendor/sherpa-ncnn/`（约 141MB，主程序未引用），以控制 APK 体积。
3. **首次安装 APK** 后，建议也上传一份 OTA 包，方便已安装用户与线上一致。
4. 若需更换 App 图标，用 Android Studio 的 Image Asset 工具，源图：`icons/app-icon.png`。
5. 发布 **Release 签名 APK** 需在 Android Studio 配置 keystore（`Build → Generate Signed Bundle / APK`）。
6. **App 内导入备份**：Android 上须先选 ZIP 文件再确认覆盖（避免文件选择器被系统拦截）；备份文件名含 `hj-backup` 或 `.zip` 均可识别。

## 已安装 App 如何更新（热更新，无需重装 APK）

1. 改完代码后递增 `index.html` 里的 `app.js?v=` 版本号
2. 本地执行：
   ```bash
   npm run build:web
   npm run build:ota
   ```
3. 将以下文件上传到 GitHub Pages **mystory 仓库根目录**（与 index.html 同级）：
   - `index.html`、`app.js`、`styles.css` 等（网页版同步更新）
   - `dist/ota-bundle.zip` → 重命名为 `ota-bundle.zip`
   - `ota-update.json`
4. 用户**关闭并重新打开 App**，启动时会自动下载并应用更新

## 重新安装 APK 的情况

仅在以下情况需要用户重新下载安装 APK：

- 更换包名或签名
- 升级 Capacitor / 原生插件
- 新增 Android 权限

日常功能更新只需 OTA，无需重装。
