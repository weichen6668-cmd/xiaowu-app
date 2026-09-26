# 小巫智能 APK 自打包指南

> 本指南教你在**不碰移动硬盘 exFAT 格式**的情况下，把项目打成 Android APK。
> 预计耗时：30 分钟（含环境安装）。

---

## 一、准备材料

把本文件夹里的 4 个文件拷到**电脑本地硬盘**（不是移动硬盘！exFAT 会生成 `._*` 幽灵文件污染编译，这是本项目反复构建失败的根本原因）：

| 文件 | 用途 |
|------|------|
| `xiaowu-mobile-source.tar.gz` (31M) | 手机端完整源码（含 Android 工程 + Web 构建产物） |
| `xiaowu-shared.tar.gz` | 公共类型/工具包（`@xw/shared`，构建需要） |
| `package.json` + `package-lock.json` | 根级依赖清单 |
| `mobile-package.json` | 手机端依赖清单 |

---

## 二、安装构建环境（一次性）

### 2.1 Node.js 18+
已装可跳过。检查：`node -v`

### 2.2 JDK 17
- 下载地址（Apple Silicon Mac）：https://mirrors.tuna.tsinghua.edu.cn/Adoptium/17/jdk/aarch64/mac/
  选 `OpenJDK17U-jdk_aarch64_mac_hotspot_17.*.tar.gz`
- 解压到任意目录，记下路径，如 `~/jdk-17`

### 2.3 Android SDK
最简单的方式是装 **Android Studio**（https://developer.android.com/studio），装好后 SDK 自动就位。
如果不想装 Android Studio，用命令行：
```bash
# 下载 commandline-tools
# https://mirrors.cloud.tencent.com/AndroidSDK/commandlinetools-mac-11076708_latest.zip
# 解压后：
export ANDROID_HOME=~/android-sdk
mkdir -p $ANDROID_HOME/cmdline-tools
mv 解压出来的目录 $ANDROID_HOME/cmdline-tools/latest
$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --sdk_root=$ANDROID_HOME "platform-tools" "platforms;android-34" "build-tools;34.0.0"
```

---

## 三、解压 + 安装依赖

```bash
# 假设你把材料放在 ~/xiaowu-apk/
cd ~/xiaowu-apk

# 解压源码
tar xzf xiaowu-mobile-source.tar.gz        # 解出 mobile/
tar xzf xiaowu-shared.tar.gz               # 解出 shared/
cp mobile-package.json mobile/package.json

# 安装依赖（在仓库根目录）
cp package.json package-lock.json .        # 如果根目录还没有
npm ci                                      # 或 npm install
```

---

## 四、构建 APK（3 条命令）

```bash
# ① 构建 Web 资源（xiaowu 模式，直连 ECS 后端）
cd mobile
VITE_DATA_BACKEND=xiaowu npx vite build

# ② 同步进 Android 工程
npx cap sync android

# ③ 编译 APK
export JAVA_HOME=~/jdk-17/Contents/Home       # 改成你的 JDK 路径
export ANDROID_HOME=~/android-sdk             # 改成你的 SDK 路径
export COPYFILE_DISABLE=1                     # 防 macOS 幽灵文件
cd android
./gradlew assembleDebug
```

**成功标志**：最后输出 `BUILD SUCCESSFUL`
**APK 位置**：`android/app/build/outputs/apk/debug/app-debug.apk`

---

## 五、已帮你改好的 8 处配置（源码里已包含）

| # | 文件 | 改了什么 | 为什么 |
|---|------|---------|--------|
| 1 | `KeystorePlugin.kt` → `KeystorePlugin.java` | Kotlin 改 Java | Gradle 没配 Kotlin 插件，.kt 编译不了 |
| 2 | `app/build.gradle` | 加 `androidx.security:security-crypto` | KeystorePlugin 依赖 |
| 3 | `variables.gradle` | `minSdk 22→23` | security-crypto 要求 API 23+ |
| 4 | `MainActivity.java` | 注册 `KeystorePlugin` | 否则 JS 调不到原生加密存储 |
| 5 | `secure-store.ts` | 加 `registerPlugin` 桥接 | 否则 apiKey 被迫存 localStorage（不安全） |
| 6 | `capacitor.config.ts` | `allowMixedContent: true` | APK 内 WebView 调 http API 需放行 |
| 7 | `AndroidManifest.xml` | `usesCleartextTraffic="true"` | Android 9+ 默认禁明文 HTTP |
| 8 | `gradle-wrapper.properties` | Gradle 镜像源 | 国内加速下载 |

> ⚠️ 以后后端上了 HTTPS + 域名，记得把 6、7 改回 `false`。

---

## 六、已知坑（帮你踩过了）

1. **exFAT 移动硬盘 = 构建杀手**：macOS 自动生成 `._*` 幽灵文件污染编译产物。**务必在本地 APFS 硬盘构建**。
2. **Gradle 镜像**：`mirrors.aliyun.com/gradle/` 没有 Gradle 发行版（404）！用 `mirrors.cloud.tencent.com/gradle/` 或 `mirrors.huaweicloud.com/gradle/`。
3. **首次构建很慢**：Gradle 要下载依赖，用国内镜像后一般 3-5 分钟。
4. **vite build 后必须 cap sync**：否则 APK 里是旧的 Web 资源。

---

## 七、装到手机

1. 把 `app-debug.apk` 微信/QQ 发到手机（或数据线拷贝）
2. 手机上点开安装（需允许"安装未知来源应用"）
3. APK 直连 `http://47.239.4.112`，登录含：**账号密码**（含忘记密码邮箱+短信找回）和**手机验证码**双 Tab

---

## 八、如果构建报错

把完整报错贴回来，我帮你排查。常见报错对照：

| 报错关键词 | 原因 | 解法 |
|-----------|------|------|
| `._drawable is not a directory` | 幽灵文件 | 换本地硬盘构建 + `COPYFILE_DISABLE=1` |
| `Invalid classfile header` | 幽灵文件混进 jar | 清理 `build/` 目录重新构建 |
| `Failed to create Jar file` | 磁盘权限/格式 | 确认在 APFS 本地盘 |
| `phone_provider_disabled` | Supabase 没开手机验证码 | 本 APK 走 ECS 后端，不走 Supabase |

---

## 九、手机云端打包（不用电脑，全程手机浏览器操作）

> 适合只有一台手机的场景。GitHub 云端免费帮你编译，直接下载 APK。

### 步骤

1. **注册/登录 GitHub**（https://github.com，手机浏览器即可）

2. **新建仓库**：点右上角 `+` → `New repository` → 填个名字（如 `xiaowu-apk`）→ `Create repository`

3. **上传材料**：
   - 进入新建的仓库 → `Add file` → `Upload files`
   - 把本文件夹的**全部内容**拖进去（包含隐藏文件夹 `.github/`，浏览器能看到）
   - 或者先在电脑上把本文件夹打成 zip 再上传（GitHub 网页不支持 zip 解压，需逐文件传或用下面的命令行方式）
   - **最简单的方式**：把 `xiaowu-mobile-source.tar.gz` 和 `xiaowu-shared.tar.gz` 解压后的内容合到一个文件夹（`mobile/` + `shared/` + `package.json` 等放同一层），再传到仓库

4. **触发构建**：
   - 上传完成后 GitHub 自动检测到 `.github/workflows/build-apk.yml`
   - 进仓库 → 顶部 `Actions` 标签 → 会看到 "Build Android APK" 自动运行
   - 等 5-10 分钟，变绿 = 成功

5. **下载 APK**：
   - 进 `Actions` → 点那次成功的构建 → 页面最下方 `Artifacts`
   - 点 `xiaowu-debug.apk` 直接下载到手机
   - 点开安装即可

### 手机操作提示
- 首次上传大量文件，建议用电脑把整个文件夹压成 zip，传到手机后用"ES文件管理器"解压，再用 GitHub App 或浏览器上传
- 如果不想传文件，也可以用 **GitPod**（https://gitpod.io）直接打开仓库在线构建

把完整报错贴回来，我帮你排查。常见报错对照：

| 报错关键词 | 原因 | 解法 |
|-----------|------|------|
| `._drawable is not a directory` | 幽灵文件 | 换本地硬盘构建 + `COPYFILE_DISABLE=1` |
| `Invalid classfile header` | 幽灵文件混进 jar | 清理 `build/` 目录重新构建 |
| `Failed to create Jar file` | 磁盘权限/格式 | 确认在 APFS 本地盘 |
| `phone_provider_disabled` | Supabase 没开手机验证码 | 本 APK 走 ECS 后端，不走 Supabase |
