# 技术关卡 1–4 实测结果

日期：2026-11-15，时区 Asia/Taipei。设备为任务指定的 vivo 真机，Android 16／API 36，未 root。**本轮关卡 1–4 全部通过；微信关卡 5–6 未执行。** 主机、虚拟设备、association、探针和手机临时文件均已清理，ADB TCP 监听已恢复为关闭。

原始证据位于 Git 忽略的 `.local/`。下文新证据路径均相对其 `round2/` 子目录；首轮失败证据仍保留在原来的 `evidence/`。没有把序列号、IP、账号或设备运行资料写入仓库。

## 逐关结论

| 关卡 | 结果 | 实际观察与证据 |
| --- | --- | --- |
| 1 创建 | **通过** | `gate1-virtualdevice.txt`／`gate1-camera.txt` 记录虚拟设备、自定义相机策略、虚拟屏幕与虚拟相机；最终 public 配置见 `public-virtualdevice.txt`、`public-camera1-service.txt`。无线重跑见 `wireless-virtualdevice.txt`、`wireless-camera-created.txt`。 |
| 2 画面到达 App | **通过，Camera1 与 Camera2 均验证** | App 真实取景与 App 内解码均得到 `android-qr-bridge:gate2:2026-11-15`。最终探针证据为 `lock-camera2.png`／`lock-camera2-tree.json` 与 `lock-camera1.png`／`lock-camera1-tree.json`；相机服务记录目标是本原型虚拟相机。不是相册读取或电脑代解码。 |
| 3 同屏操作 | **通过** | `gate3-before.png`／`gate3-before-tree.json` 与 `gate3-after.png`／`gate3-after-tree.json` 的显示编号相同，CLI 点击后“点击次数：0”变为“点击次数：1”，见 `gate3-tap.json`、`gate3-verdict.json`。 |
| 4 无线 | **通过，连接方式边界见下文** | 创建主机和重跑 1–3 的所有 ADB 命令均选择 Wi-Fi 标识；USB 线仍连接供电，没有用 USB transport 完成这些验证。`wireless-camera2.png`／对应树、`wireless-camera1.png`／对应树解出无线测试码，`wireless-counter.png`／树记录 0→1。无线 transport 断开约 15 秒再重连，PID、设备、持久 ID、相机与显示均相同（`wireless-lifetime-verdict.json`、三份 `wireless-devices-*.txt`）；随后新码在 App 内解出，点击 1→2（`reconnected-camera1.png`、`reconnected-counter.png`、对应树、`wireless-final-verdict.json`）。 |

无线测试码原文为 `android-qr-bridge:wireless:2026-11-15`；重连后成功解出的新码为 `android-qr-bridge:after:2026-11-15`。最终主机构建另以无线启动、按设备授权、取景解码复核，见 `final-build-status.json`、`final-build-permission-grant.json`、`final-build-camera2.png` 与对应树。

## 已证实的按设备权限原因

首轮包管理器显示探针 CAMERA 已授予，但 Camera2 打开虚拟相机时报错：

```text
java.lang.SecurityException: validateClientPermissionsLocked:1967: Caller "%s" (PID %d, UID %d) cannot open camera "%s" without camera permission
```

原始失败在上一轮 `evidence/gate2-androidruntime.txt` 和 `evidence/after-camera.txt`，后者把 REJECT 明确关联到本次虚拟相机。

本轮在真实 `permissionmgr` 服务上核对并调用：

```text
public void android.permission.IPermissionManager$Stub$Proxy.grantRuntimePermission(
    java.lang.String, java.lang.String, java.lang.String, int)
    throws android.os.RemoteException
```

参数依次为包名、权限名、`VirtualDevice.getPersistentDeviceId()`、用户编号 0。查询使用 `checkPermission(packageName, permissionName, persistentDeviceId, userId)`，返回 `-1` 为拒绝、`0` 为已授予。签名日志见 `host-before-process-exit.txt`；授权前后查询见 `permission-before-grant.json`、`permission-grant.json`、`permission-after-grant.json`。

**同一持久设备 ID 下，探针权限从 -1 变为 0，随后成功打开虚拟相机并解码，证实本次拒绝是默认设备授权不能替代该虚拟设备授权。** 源码位置：Android 16 固定提交 `99b01a65cc4c104933788b3143285ab6bae65827` 的 [IPermissionManager.aidl 第 68 行](https://github.com/aosp-mirror/platform_frameworks_base/blob/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/permission/IPermissionManager.aidl#L68)、同文件第 105 行的查询签名，以及 [PermissionManager.java 第 663–681 行](https://github.com/aosp-mirror/platform_frameworks_base/blob/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/permission/PermissionManager.java#L663)。源码快照在本机 `sources/`。

CLI 已提供 `camera-permission 包名` 与 `grant-camera 包名`，可供后续 Worker 对当前虚拟设备上的指定包使用，不预设业务 App 包名。

### 未预授权时的 requestPermissions

在早期 private 虚拟显示上，以冷启动参数让探针只请求 CAMERA、不打开相机。系统出现了明确询问能否在该虚拟设备上拍照录像的授权框，设备名称显示为 association 的 APP_STREAMING 角色名称。**授权框在物理主屏，探针任务同时从虚拟屏移到主屏。**

证据：`request-permission-physical.png`、`request-permission-windows-settled.txt`（GrantPermissionsActivity 的显示编号为默认显示）、`request-permission-screen.png`（虚拟显示为空）、`permission-before-request.json` 与 `permission-after-request.json`（均为 -1）。没有点击允许，结束探针后才通过 shell 按设备授权；此框没有用于关卡通过。最终 public 配置未重复此项观察。

### association 重建

删除重建后，`persistent_device_id` 随 association 编号改变；在新持久 ID 上，同一探针的 CAMERA 返回 -1，需重新授予。对照 `gate1-status.txt`／`recreated-status.json`、`permission-after-grant.json`／`recreated-permission-before.json`，以及后续无线重建的 `wireless-permission-before.json`、`wireless-permission-grant.json`。同一 association 内更新探针 APK 后，权限仍为 0（`lock-permission.json`）。

## 四个假设的查明结果

| 假设 | 结果与边界 |
| --- | --- |
| 创建进程退出是否移除虚拟设备、断开启动连接是否存活 | **已证实。** 对本实验主机发送 SIGKILL 后，虚拟设备立即从 dumpsys 消失（`device-after-process-exit.txt`），所以创建进程必须常驻；`nohup` 主机在无线 transport 断开约 15 秒后仍以相同 PID／设备／相机／显示响应，能继续送图与操作。 |
| 相机可见范围、已有主屏任务如何迁移 | **已做有限对照。** 同一 shell UID 的默认设备与虚拟设备 Context 枚举结果不同（`camera-visibility.json`、`final-build-cameras.json`）；虚拟设备相机在 API 中映射为 0，相机服务显示为 `v...`，Probe 的消费方记录对应虚拟相机。现有探针任务从虚拟屏移到主屏再移回，任务编号与 Activity 实例保持，原任务被迁移而不是克隆（`migration-before/default/virtual-probe-tasks.json`）。未把任何已有业务 App 做此迁移，不能推广其任务行为。 |
| 后置朝向与 Camera1／Camera2 格式尺寸 | **此配置已验证可消费。** 后置、方向 0°、640×480 RGBA_8888 输入、30 FPS；Camera2 请求 640×480 预览和 YUV_420_888，Camera1 请求 640×480 NV21，均在 App 内解码成功。没有探测其他尺寸或其他镜头朝向。 |
| 手机锁屏时能否运行与取景 | **未验证。** 无线验收记录为 Awake、SCREEN_STATE_ON、keyguard showing=false（`wireless-power.txt`、`wireless-window-policy.txt`）；因手机存在用户及 CI 并行操作，没有主动锁屏或修改锁屏设置。不能把亮屏验收扩写为锁屏取景成功。 |

## 中间故障、修正与并行影响

- private 虚拟显示没有无障碍窗口，读树为空。AOSP `AccessibilityManagerService.AccessibilityDisplayListener.isValidDisplay` 明确过滤非 SystemUI 所有的 private 虚拟显示（[固定源码第 5641 行](https://github.com/aosp-mirror/platform_frameworks_base/blob/99b01a65cc4c104933788b3143285ab6bae65827/services/accessibility/java/com/android/server/accessibility/AccessibilityManagerService.java#L5641)）；最终改为 PUBLIC／OWN_CONTENT_ONLY 后，同一显示可截图、读树和点击。没有改手机安全设置。
- 探针从 Camera2 切换 Camera1 时，曾因 ImageReader 被关闭而出现 `buffer is inaccessible`（`gate2-camera1-runtime.txt`）。最终将缓冲区读取与 reader 关闭放在同一互斥区，切换与生命周期仍由 UI 线程负责；修正后 Camera1／Camera2 都通过。
- 先前将整个切换排入相机回调线程的探针版本未完成切换；该版本未作为通过证据，最终替换并重跑，证据使用 `lock-*` 和 `wireless-*`。
- 一个额外生成的 `reconnected` 文本测试码在手机上未解出，电脑直接读取该 PNG 也得到 ZXing `NotFoundException`（`reconnected-qr-local-decode.txt`），因此没有把该失败归因于无线。换用先在电脑核验可解码的新测试码后，手机在同一连接与主机上成功解码（`after-qr-local-decode.txt`、`reconnected-after-camera1-tree.json`）。没有换相册路线，也没有在交付代码加入解码回退或重试。
- 后续已确认手机并非独占：另有 ideaflow CI runner，用户也可能触屏。安装与前台切换异常可能受其干扰；先前没有观察到取景的那次启动未用作验收，改用等待实际启动完成后重跑。探针更新安装只确认核对过应用名的本任务 session；未确认或取消其他 App 的安装。一次恢复时物理截图因前台变化截到其他 App，已删除该无关截图，未操作其中内容；之后尽量读取虚拟显示与系统窗口元数据。
- 主机 `start` 是异步启动。一次紧接启动的状态查询在服务就绪前收到空响应；查看原始 READY 日志后查询及最终取景成功。最终 READY 标记放在监听套接字绑定之后，CLI 没有隐藏或自动重试这些错误。

## 无线方式的边界与恢复

本轮使用传统 `adb tcpip`，不是 Android 原生 TLS 无线调试。前置条件是手机开发者选项／USB 调试已开启、已有电脑授权、Wi-Fi 与电脑互通，首次借 USB 开启 TCP。VPN 未关闭，“无线调试”开关未打开，也未新增配对记录。Wi-Fi 验证时 USB 线仍连接，但每个验证命令和主机推送都显式使用无线 transport。

**这证明已激活的网络连接下可以无 USB 传输运行，不证明手机重启后完全无 USB 激活。** 重启会结束主机，需要重新建立可用 ADB 连接、创建虚拟设备和按新持久 ID 授权。传统 TCP 开关是否跨重启保留未测试；若实际使用没有 USB，应另行验证原生无线调试配对入口，本轮没有替它作通过结论。

开始时 `service.adb.tcp.port` 与持久 TCP 属性为空、`adb_wifi_enabled=0`。结束经 `adb usb` 恢复后，service TCP 属性为 0、持久属性仍为空、无线调试仍为 0，实际 5555 没有 LISTEN；无线连接已断开。证据：`adb-before-wireless.txt`、`adb-tcpip.txt`、`adb-restore-usb.txt`、`after-listeners.txt`、`cleanup-verification.json`。

## 手机安装项、设置与清理

| 本次项目 | 清理与最终状态 |
| --- | --- |
| 自建 `local.qrbridge.probe` APK，内含 ZXing core 3.5.3；中间更新过探针版本 | 已卸载，`cleanup-uninstall.txt` 为 Success，最终用户 0 包列表为空；未卸载任何原有 App。 |
| 探针默认设备 CAMERA 与各实验持久设备 ID 下的 CAMERA | 默认授权随探针卸载移除；虚拟权限对应的 association 已删除。没有为其他包授权。 |
| shell／APP_STREAMING association，虚拟设备、显示与摄像头 | 最终 `stop` 移除，`after-virtualdevice.txt` 无活动设备；`after-camera.txt` 的虚拟 provider 为 0 个设备，原主机 PID 不存在。 |
| `/data/local/tmp/android-qr-bridge/` 中的 JAR、枚举辅助 JAR、PID 与日志 | 日志取回 `device-final/` 后，手机端整个目录已删除。 |
| ADB 临时本机转发、TCP 监听 | 请求结束移除本机转发；TCP 已恢复关闭，无线 transport 已断开，见 `after-forward.txt` 与最终清理核验。 |
| APP_STREAMING 角色与 shell 原有权限 | 无遗留角色 holder；原有其他 association 保留，任务列出的 shell 权限仍获授，见 `after-role.txt`、`after-companion.txt`、`after-shell-permissions.txt`。 |

未 root、未重启、未改 bootloader、锁屏或安全设置；未打开或操作微信、支付宝或 Andfiles helper。并行 CI 与用户操作产生的其他 App 安装和设置不属于本任务，也没有作为本任务清理对象。

## 验证与下一 Worker

Java 主机和探针成功构建；Python CLI 的复杂度问题已按参数解析、文件保存和显示操作拆分修正。`scripts/agent-check diff` 已通过（退出码 0，见本机 `agent-check-result.json` 与 `agent-check.txt`），最终构建日志为 `host-build-final.txt`、`probe-build-lock.txt`，CLI 参数说明见 README。

下一个 Worker 现在可以在其业务授权范围内开展微信关卡 5–6：建立可用连接并启动主机，先对目标包执行 `camera-permission`／`grant-camera`，再将 App 定向到同一虚拟屏幕，用 `image` 送码、`tree`／`screenshot` 核对与 `tap` 操作。仍需在原版微信实际验证“扫一扫取景显示图片”“识别进入确认页”“网页端已登录”三个结果；这轮仅验证技术前提，没有证明微信兼容，也没有执行登录确认。


## 微信关卡 5–6

2026-11-15，vivo 真机通过 USB ADB 执行。主机 READY 后查询状态，微信在虚拟设备的相机权限由 -1 授予到 0，已送入探针生成的静态已知码。微信主界面和控件树出现在虚拟屏幕，但进入“扫一扫”后活动转到物理屏幕，物理取景显示真实环境；相机服务记录微信 CONNECT 设备 0，主机状态显示虚拟流数为 0。

按授权对微信 force-stop 一次并在虚拟屏幕冷启动，主界面仍出现在虚拟屏幕；再次进入“扫一扫”后活动又转到物理屏幕，相机服务再次记录微信 CONNECT 设备 0，虚拟流数仍为 0。虚拟屏幕截图此时全黑是因为扫码活动已迁出，不能据此断言微信的相机取景黑屏或拒绝 640×480。**关卡 5 未通过**：未显示送入图片，也没有微信连接虚拟相机的证据；关卡 6 按顺序未执行，识别登录码、进入确认页、网页端已登录均未发生或验证。

退出扫一扫后微信主界面回到物理屏幕且仍登录。主机已停止，虚拟设备列表为空，原型 association 已移除，手机临时目录已删除；未打开网页或创建浏览器 task-space，也未创建网页会话。截图、控件树、主机日志、状态及相机服务转储存于 Git 忽略目录 `.local/round3/`。

## round4：子活动留屏的根因与修复

2026-11-15，继续使用同一台非 root Android 16 真机与 USB ADB。**自建探针已证明修复有效；微信关卡 5 仍待 Terra 复测，关卡 6 未执行。** 本轮没有启动、结束或操作微信／支付宝，没有访问聊天；对微信只读包属性和系统已保存的活动事件。所有原始证据位于 `.local/round4/`，显示编号由系统递增分配，没有强行复用 round3 的 display 18。

### 只读诊断

`dumpsys package com.tencent.mm` 没有列出完整 ActivityInfo，因此用 shell 的 PackageManager `GET_ACTIVITIES` 读取有效属性。辅助源码与结果分别为 `ActivityAttributes.java`、`wechat-activity-attributes.json`；只查询元数据，不加载或启动微信 Activity。微信版本 8.0.80、targetSdk 34：

| 活动 | launchMode | resizeMode | screenOrientation | taskAffinity | 其他标志 |
| --- | --- | --- | --- | --- | --- |
| `com.tencent.mm.ui.LauncherUI` | 1，singleTop | 1，RESIZEABLE | -1，未指定 | `com.tencent.mm` | 允许远程显示；allowEmbedded=false。 |
| `com.tencent.mm.plugin.scanner.ui.BaseScanUI` | 2，singleTask | 1，RESIZEABLE | 1，portrait | `com.tencent.mm` | 允许远程显示；allowEmbedded=false；exported=false。 |

`wechat-activity-events.txt` 还能读到 round3 的两次 BaseScanUI 启动、固定竖屏请求，以及 `PointerEventDispatcher0` 上的扫码窗口交互，与当时物理截图和 `CONNECT device 0` 相符。本轮开始时扫码活动已经结束，不能再对它做当前任务 dump；`activities-before.txt` 中微信只剩 display 0 的 LauncherUI。物理 display 0 属于 group 0，见 `display-before.txt`。

**根因是旧虚拟显示未标记 TRUSTED。** AOSP 的 [ActivityTaskSupervisor 启动检查](https://github.com/aosp-mirror/platform_frameworks_base/blob/99b01a65cc4c104933788b3143285ab6bae65827/services/core/java/com/android/server/wm/ActivityTaskSupervisor.java#L1147)允许有 `INTERNAL_SYSTEM_WINDOW` 权限的调用者通过；普通 App 在不受信任显示上启动未声明 `FLAG_ALLOW_EMBEDDED` 的活动则不通过。该手机 shell 具备前者，微信扫码没有后者。这解释了 shell 能定向启动微信主界面，而 App 内启动扫码活动却回主屏。下列同机最小对照支持这个原因，无需把固定方向或相机格式猜作原因；微信实际复测仍是最终确认。

### 可复现的探针对照

主机继续通过 `VirtualDevice.createVirtualDisplay` 创建显示；原先已是此路径。本次增加三个显示模式、实际显示组／flags 状态、活动监听，并明确活动策略为 DEFAULT（允许启动）。`mDefaultActivityPolicy=0`、`mDefaultNavigationPolicy=0` 在旧配置下也已允许，修复没有靠放宽原本禁止的活动名单。

| 配置 | 实际显示／显示组／相机 | 子活动结果 |
| --- | --- | --- |
| 旧 `PUBLIC | OWN_CONTENT_ONLY` | display 19／group 0／`v7_1006` | singleInstance、NEW_TASK、新启动的竖屏 singleTask 均回物理 display 0；最新 CONNECT 均为相机 0，断言失败。 |
| 仅增加 TRUSTED | display 20／虚拟设备 group 1／`v8_1007` | 上述三种均留在 display 20、连接该虚拟相机并在 App 内解出已知码。 |
| 默认 isolated：再加 OWN_DISPLAY_GROUP、ALWAYS_UNLOCKED | display 21／独立 group 2／`v9_1008` | 上述三种及不可缩放＋竖屏的新任务均留在 display 21、连接该虚拟相机并解码。 |
| isolated 的负对照：App 显式指定 display 0 | 子活动为 display 0／group 0 | 仍去物理屏幕并 CONNECT 相机 0；虚拟设备的允许启动策略不能强制覆盖这个选择。 |

已知码原文为 `android-qr-bridge:gate2:2026-11-15`。每个成功样本都从虚拟显示上的主活动读取按钮位置后点击打开子活动，子活动再打开 Camera2；不是从 shell 直接启动子活动。子活动为未导出的原型类，标题显示实际 display／device／task；singleInstance、NEW_TASK 的 task ID 与主活动不同。最终配置的固定竖屏 singleTask 和不可缩放对照分别保留于 `isolated-portrait-repeat/`、`isolated-unresizable/`，不能据固定方向或不可缩放属性宣判该手机的路线必然失败。

每个样本目录含 `main-tree.json`、`child-tree.json`、`child.png`、`activities.txt`、`camera.txt`、`status.json`、`verdict.json`；成功树的 `display_id=21`，子活动标题含 `device=9`，相机服务最新记录为 `CONNECT device v9_1008 ... local.qrbridge.probe`。配置依据在 `baseline-display.txt`、`trusted-display.txt`、`isolated-display.txt` 及同名前缀的 `virtualdevice` 文件；监听事件在 `trusted-host.txt`、`isolated-host.txt`、`host-final.txt`。

复现命令已实际执行：

```sh
python3 .local/round4/run_case.py \
  .local/round4/baseline-singleinstance singleInstance SingleInstance
# 旧主机：child_on_virtual=false，latest_connect=device 0，退出 1。
python3 .local/round4/run_case.py \
  .local/round4/isolated-singleinstance singleInstance SingleInstance
# 新主机：child_on_virtual=true，decoded_on_virtual=true，latest_connect=v9_1008，退出 0。
```

脚本在启动主机、授权及送码之后运行，一次约 6 秒；无自动重试。它同时断言子活动标题、App 内解码原文与最新相机 CONNECT，避免把仍在虚拟显示上的主活动解码误当成子活动成功。旧配置与显式 display 0 负对照即使主活动仍有解码文字也判失败。此故障应由“普通 App 从副屏启动子活动”的真机集成验证捕获，仅验证 shell 启动主活动不足。

有两次取样未纳入通过／迁屏结论：`trusted-unresizable/` 未取得主活动按钮；首次 `isolated-portrait/` 中子活动确实曾在 display 21 打开虚拟相机，但随后被 `app-request` 结束，取样时已回到主活动，见 `probe-events.txt`。没有把它解释为系统迁屏，也没有把原因断定为 CI 或用户；后续独立重跑 `isolated-portrait-repeat/` 完整通过。手机当时仍有其他使用者／runner，未操作其界面或安装提示。

### 微信判断与 Terra 复测前提

未发现要求 root、改包或系统签名才能排除的扫码活动属性；本机 shell 已有 `ADD_TRUSTED_DISPLAY` 和 `ADD_ALWAYS_UNLOCKED_DISPLAY`，新配置实际创建成功。微信可缩放、允许远程显示，且其 singleTask＋portrait 模式已由探针覆盖，**有充分依据继续原路线复测，但尚不能宣布微信关卡 5 通过**。若微信自己显式选择主屏，或存在额外 vivo 专属策略，允许启动策略仍不能强制留屏；本轮负对照明确保留这一限制。

Terra 应重新构建／启动默认 `start`（不要用 legacy），确认 `log` 出现 READY，`status` 显示 isolated、非 0 的显示组及新分配的显示编号；重建 association 后先为目标包重新查询／授予当前持久设备 ID 的 CAMERA，再送码和定向启动。复测应同时保存活动监听、控件树显示编号、任务落点和 `media.camera`；必须观察微信 CONNECT 新的 `v...` 及实际取景后才能推进关卡 5，其后才按已有授权做关卡 6。本轮没有进行微信复测，也没有相册识别、AndroMeld、root 或改包。

### 清理与检查

只新增安装了自建探针及其 CAMERA 权限，结束已 force-stop 并卸载；三轮 association、虚拟设备、相机和显示均已释放，原有其他 association 保留，association 的 Max ID 因正常创建递增。手机端诊断 JAR、主机、控件树临时文件及整个 `/data/local/tmp/android-qr-bridge/` 已删除，原主机 PID 已退出，虚拟 camera provider 为 0 devices。证据为 `stop.json`、`uninstall.txt`、`virtualdevice-after.txt`、`companion-before.txt`／`companion-after.txt`、`host-pid-check.txt`、`remote-after.txt` 和 `camera-after.txt`。

本轮全程 USB，没有更改 ADB 监听：service TCP 仍为 0、persist TCP 仍为空、无线调试仍为 0，本机转发列表与开始相同。没有修改手机锁屏、安全设置或其他 App；`ALWAYS_UNLOCKED` 仅作为虚拟显示标志，新配置下的锁屏实验未重复。开始／结束属性见 `adb-*-before.txt`／`adb-*-after.txt`、`forward-before.txt`／`forward-after.txt`；最终核验汇总见 `cleanup-verification.json`。

主机与探针构建成功，CLI 参数帮助和 Python 语法检查通过；`scripts/agent-check diff` 退出 0，原始输出在 `agent-check.txt`，结果记录在 `agent-check-result.json`。本轮仅改动实验目录，没有提交 Git；早先关卡 1–4 的无线及 Camera1 结果仍属于其原轮次，本轮子活动验收使用 Camera2 和 USB。

## 微信关卡 5–6 复测

2026-11-15，经 USB ADB 复测默认 isolated 模式。主机 READY，系统分配 display 22、非 0 的 display group 2；新 association 的微信 CAMERA 权限从 -1 授予到 0。微信主界面定向到虚拟显示，进入扫一扫后，`dumpsys activity` 和活动监听均记录 `BaseScanUI` 在 display 22；`media.camera` 最新微信 CONNECT 为虚拟相机 `v10_1009`，状态有一个流。

已知静态码在取景画面中可见（`round5/known-take3.png`），微信随后显示其解码原文。控件树的顶层 `display_id` 为 22，但多次返回的窗口节点均为 null 且没有子节点；活动落点由系统活动转储和监听独立证实。**关卡 5 通过。** 当时因空控件树将交付判为 failed 属于证据判据误用；相机预览不提供可读文字节点是正常现象，机制补证见 round6。

网页二维码截图裁切留白后，电脑端 ZXing 解码成功，再送入虚拟相机。微信识别到登录码并显示登录确认页；首次确认后网页仍在二维码页，重截当前码重试后点确认，网页进入文件传输助手，三项业务结果均已观察到，**关卡 6 的业务链通过**。网页会话点击关闭后回到二维码页，独立 ego-lite task-space 已关闭。截图和原始证据保存在 Git 忽略的 `.local/round5/`。

一次菜单动画期间点击过早，误打开了一个聊天并立即返回，可能改变该会话的未读状态；未发送消息，误入界面的截图已删除。登录确认后微信自动打开文件传输助手，退出该界面并删除其截图。微信已返回物理 display 0，主界面仍为登录状态；主机停止、虚拟设备及本次 association 移除，手机临时目录删除，ADB TCP 属性、无线调试值和转发列表与开始一致。未改系统设置、未使用相册或 AndroMeld。

## round6：交付帧与消费内容自证

2026-11-15，本轮只修改主机与 CLI，复用已有 Camera2 探针，通过 USB 在同一台非 root Android 16 真机验证；没有打开或操作微信、支付宝。证据位于 `.local/round6/`。

新增 `capture-frame 输出目录`：一次命令只消费下一次 `onProcessCaptureRequest`。主机按相机请求 Surface 的实际尺寸，将原图等比缩放、居中补白到位图，将该位图本身画入 Surface，在成功 `unlockCanvasAndPost` 后编码同一位图。电脑保存带毫秒时间戳的 PNG 和元数据 JSON，含 UTC、流与请求帧编号、相机、显示与尺寸；平时仍直接绘制，不持续编码或保存帧。探针源码、显示配置与相机输入格式未改变。

### 三项自证全部通过

| 判据 | 实际结果 | round6 证据 |
| --- | --- | --- |
| 交付帧与消费帧内容一致、解码原文相同 | 原图、主机交付 PNG 的电脑端 ZXing 解码、探针 Camera2 从真实 YUV_420_888 帧解码均为 `android-qr-bridge:round6:2026-11-15`。源图 360×360，交付帧 640×480；码图放大到 480×480，左右 80 像素补白经逐像素检查为白色。 | `known-qr.png`、`source-decode.json`、`delivered-1794739195196-s1-f221.png`／同名 JSON、`delivered-decode.json`、`consumer-texts.json`、`child-tree.json`、`child-after-capture.png`。 |
| isolated 留屏 | 使用默认 `start`，display 23、group 2、flags 3968。从探针主活动实际点击 `SINGLETASK 竖屏` 打开未导出的 `PortraitTask`；活动转储为 `launchMode=2`、portrait、RESIZEABLE，仍在 display 23，子活动截图及标题显示同一落点并解码。 | `start.json`、`status-capture.json`、`main-tree.json`、`main.png`、`activities.txt`、`display.txt`、`host-final.txt`、`child-after-capture.png`。 |
| 消费方连接虚拟相机 | 相机服务最新探针记录为 `CONNECT device v11_1010 ... local.qrbridge.probe`；相同相机的 stream 1、请求帧 221 留证成功，交付时间为 `2026-11-15T10:39:55.196Z`。 | `camera.txt`、`capture.json`、交付帧同名 JSON、`status-capture.json`、`verdict.json`。 |

内容一致按同一已知码原文判定；RGBA 主机帧进入 Camera2 YUV 帧会有格式转换，本轮没有声称两者逐字节相同。探针的解码在 ImageReader 消费回调中完成，界面上的原文来自该回调；没有把电脑代解码当作手机解码。`verdict.json` 对三项结果联合断言，`passed=true`。停掉探针后再次请求留证，主机明确报“相机尚无消费方”，CLI 非零退出且未写出旧帧，见 `status-no-consumer.json`、`no-consumer-error.txt`、`no-consumer-result.json`。

### 空控件树的定性与端到端证据链

**扫码活动控件树为空是相机预览的正常现象，不是缺陷。** 微信扫一扫的 SurfaceView 预览内容不是可读文字控件，虚拟显示截图也可能不包含这个预览层；控件树和截图分别记录界面节点与显示合成结果，不能替代相机消费内容的证据。round5 已有活动落点、虚拟相机连接、实际识码和网页登录，不能因空树将这些结果推翻。

完整链条为：`round5/scan-activities.txt` 与 `scan-host.txt` 确认 BaseScanUI 在 display 22 → `round5/scan-camera.txt` 确认微信 CONNECT `v10_1009`、`scan-status.json` 有流 → 本轮一次性交付帧与 Camera2 消费方均解出同一原文，证明该缩放、补白和 Surface 交付路径成立 → round5 的业务观察和 `web-logged.png` 等截图记录确认及网页登录结果。该结论不要求扫码活动提供可读控件树。

证据轮次保持清楚：round5 没有保存主机交付帧，本轮用探针补齐的是交付机制的内容自证，没有重新打开微信或重新登录网页，也没有把本轮帧冒充为 round5 登录码的逐帧记录。后续已获授权的扫码运行可直接调用 `capture-frame` 同轮留证。

### 清理与检查

开始时探针未安装，手机实验目录不存在；安装前和每次确认前核对了应用名“二维码桥接探针”，只确认本次安装的风险提示与继续按钮，未操作其他 App 的安装提示。其他步骤先读取系统当前窗口，虚拟屏幕点击以刚取得的主活动控件树为依据；未切换或操作其他业务 App。

结束已停止并卸载本轮新增探针、停止主机，移除本轮 association、虚拟设备、显示和相机，删除 `/data/local/tmp/android-qr-bridge/`。原有其他 association 保留；全程未改变 ADB 监听，service TCP=0、persist TCP 为空、无线调试=0、本机转发列表保持原状。清理原始记录为 `stop.json`、`uninstall.txt`、`virtualdevice-after.txt`、`camera-after.txt`、`companion-after.txt`、`remote-after.txt`、`host-pid-after.txt`、`adb-*-after.txt` 与 `forward-after.txt`，汇总见 `cleanup-verification.json`。

主机成功构建；CLI 参数帮助、Python 语法检查和 `scripts/agent-check diff` 通过，结果见 `build.txt`、`capture-help.txt`、`python-syntax.txt`、`agent-check.txt`、`agent-check-result.json`。仅改动实验目录与本地证据目录，没有提交 Git。

## 关卡 4b：原生无线调试、物理拔线与重启重连（round7）

2026-11-15，同一台未 root 的 Android 16 真机。**原生无线配对连接、拔线存活、重启后无 USB 重新激活三项通过；重启后的重新激活需要用户在手机上重新打开无线调试，不能全自动恢复。** 本轮只使用自建探针，没有打开或操作微信、支付宝。原始证据位于 Git 忽略的 `.local/round7/`。

本轮开始时仅有 USB transport，`service.adb.tcp.port=0`、`persist.adb.tcp.port` 为空、`adb_wifi_enabled=0`，转发列表为空，探针未安装，手机临时目录不存在。按用户后续要求，最初进入设置、打开无线调试和读取配对界面由 Agent 通过 USB ADB 操作；`adb pair`、`adb connect`、安装探针、创建主机及关卡 1–3 均显式选择原生 TLS 无线标识，没有执行 `adb tcpip`。因此初次手机界面设置时 USB 仍插着；不能把这次记录写成“初次配对前就已拔线”。随后物理拔线与重启后的启动、通信和操作均在无 USB 下完成。

| 验收项 | 结论与边界 | round7 证据 |
| --- | --- | --- |
| 原生无线配对连接、关卡 1–3 | **通过。** 从原生“使用配对码配对设备”界面取得配对地址和六位码，`adb pair` 成功，连接使用主界面的独立连接端口；设备列表同时存在 USB 与独立 TLS 无线 transport。主机 READY，isolated、显示组非 0；按当前虚拟设备授予 CAMERA 后，Camera2 与 Camera1 均在 App 内解出本轮 paired 码。同一虚拟显示的截图、树和点击证明计数 0→1。 | `adb-pair.txt`、`adb-connect.txt`、`adb-devices-paired.txt`、`host-ready.txt`、`status-paired.json`、`permission-grant.json`、`virtualdevice-paired.txt`、`camera-paired.txt`、`paired-camera2.png`／对应树、`paired-camera1.png`／对应树、`paired-counter-tree.json`、`paired-verdict.json`。 |
| 物理拔线后存活与继续操作 | **通过。** 用户确认拔线；USB transport 消失，`USB powered=false`。主机 PID、虚拟设备、持久 ID、相机、显示和显示组与拔线前相同。无线提交新的 unplugged 码后，探针 Camera1 重新取景解出该码，点击计数 1→2。 | `adb-devices-unplugged.txt`、`battery-unplugged.txt`、`status-before-unplug.json`／`status-after-unplug.json`、`image-unplugged.json`、`unplugged-camera1-rescan-tree.json`、`unplugged-before-tap.png`／`unplugged-after-tap.png`、`unplugged-counter-tree.json`、`unplugged-verdict.json`。 |
| 重启后无 USB 重新激活 | **通过，需用户重新开开关。** 通过无线执行 `adb reboot`，前后 boot ID 不同；旧主机和虚拟设备结束，旧 association 仍保存。正常解锁后，旧连接端口拒绝连接，设备列表为空且没有本机 TLS mDNS 服务。用户确认无线调试开关重启后为关，重新打开后原电脑配对仍在；无需再 `adb pair`，直接连接新的连接端口。无线 `stop` 清理旧 association，再 `start` 创建新主机，等待 READY、重新按虚拟设备授予 CAMERA，送 rebooted 码；探针 Camera2 在新虚拟显示上解码成功。 | `reboot-command.txt`、`boot-id-pre-reboot.txt`／`boot-id-rebooted.txt`、`mdns-after-unlock.txt`、`adb-devices-after-unlock.txt`、`old-endpoint-after-unlock.txt`、`connection.json`（用户反馈，仅本地）、`adb-connect-rebooted.txt`、`adb-devices-rebooted.txt`、`virtualdevice-post-reboot-before-start.txt`、`companion-post-reboot-before-start.txt`、`stop-stale-after-reboot.json`、`host-rebooted-ready.txt`、`permission-rebooted-grant.json`、`rebooted-camera2-tree.json`、`rebooted-camera2.png`、`rebooted-verdict.json`。 |

paired、unplugged、rebooted 码分别为 `android-qr-bridge:round7:paired:2026-11-15`、`android-qr-bridge:round7:unplugged:2026-11-15`、`android-qr-bridge:round7:rebooted:2026-11-15`，源图均先经电脑端 ZXing 核验。探针解码成功后会保留首个结果；换图后点击一次 CAMERA1 按钮清空旧结果并重新打开同一虚拟相机，随后才采集新码的通过证据，没有把残留的 paired 文字当作新码成功。

重启后还执行了一次 `capture-frame`：实际交付帧为 640×480，电脑端 ZXing 与探针 Camera2 解出的 rebooted 原文相同，左右补白为白色。证据为 `capture-rebooted.json`、`rebooted-delivered/` 中的 PNG／同名元数据、`rebooted-delivered-decode.json`、`camera-rebooted.txt`；手机电池状态仍为 `USB powered=false`（`battery-rebooted.txt`）。

### 重启后的实际操作顺序

1. 用户保持 USB 拔开，正常解锁手机，进入开发者选项，重新打开“无线调试”。本机仅解锁不足以恢复连接；无可用 ADB 通道时，电脑无法自行操作这个开关。这是手机上的必要人工步骤，未改锁屏或其他安全设置。
2. 配对保留时不重新配对。由用户读回无线调试主界面的新连接端口，再 `adb connect "$WIRELESS_SERIAL"`；也可先查看 `adb mdns services` 是否已发现该手机。本轮实际使用用户读回的新端口，不能假定旧端口或 5555 继续可用。
3. 本轮旧 association 在重启后仍存在，先运行 `bridge.py --serial "$WIRELESS_SERIAL" stop` 清理它，再 `start`；核对 `log` 中 READY 与 `status` 的 isolated、非 0 显示组及新分配显示编号。随后为目标包按新持久设备 ID 授予 CAMERA，再 `image` 和 `launch`。

这证明同一 Wi-Fi 下可以无 USB 重新激活，不代表重启后开关自动保持、主机自动启动或换 Wi-Fi 自动恢复；换 Wi-Fi、单独重启 adbd、初次配对前已拔线均未额外测试。不需要 root、系统签名、插回 USB 或重新安装探针。

### 清理与最终状态

主机已停止，原型 association、虚拟设备、显示和摄像头均移除；本次新装探针已 force-stop 并卸载，手机实验目录及 UI dump 临时文件已删除，原有其他 association 保留。传统 TCP 未启用，重启后的 service TCP 属性为空（开始为 0），persist TCP 仍为空，均无传统 TCP 监听；本机转发列表为空。清理证据为 `stop-final.json`、`uninstall-probe.txt`、`remote-remove.txt`、`ui-temp-remove.txt`、`virtualdevice-after.txt`、`camera-after.txt`（virtual provider 为 0 devices）、`companion-after.txt`、`host-pid-after.txt`、`probe-after.txt`、`remote-after.txt`、`forward-after.txt`、`adb-*-after.txt`、`cleanup-verification.json`。

用户选择保留无线连接：最终无 USB transport，原生无线调试开启，电脑配对保留；传统 TCP 关闭且没有 5555 监听，本机转发为空。最终证据为 `adb-devices-final.txt`、`adb-wifi-final.txt`、`adb-service-final.txt`、`adb-persist-final.txt`、`listeners-final.txt`、`forward-final.txt` 与 `final-connection-verdict.json`。

`scripts/agent-check diff` 通过，退出码 0，见 `agent-check.txt` 与 `agent-check-result.json`。本轮只更新 RESULTS 与场景执行记录，没有暂存或提交 Git；所有 IP、序列号、配对码与原始设备资料仅保存在本地证据目录。

## 支付宝关卡 5–6（round8）

2026-11-15，在已登录的 vivo Android 16 手机上使用原生无线调试 transport。**关卡 5 和关卡 6 通过**；原始证据和界面截图仅存于 Git 忽略的 `.local/round8/`。

只读诊断确认包 `com.eg.android.AlipayGphone`，启动器为 `.AlipayLogin`，声明 CAMERA 运行时权限。实际进入的扫码活动是 `com.alipay.mobile.scan.as.main.MainCaptureActivity`：活动转储为 `launchMode=0`（standard）、竖屏、`RESIZE_MODE_UNRESIZEABLE`，任务 affinity 为支付宝包名；APK 清单该活动声明 `resizeableActivity=true`，未显式声明 `launchMode`、`taskAffinity` 或 `allowEmbedded`，故后者为默认值。运行时 resizeMode 与清单声明不一致，以上分别记录，不能以清单代替实测。对照 round4，固定竖屏、未声明 allowEmbedded 是需要实测留屏的因素；本轮 isolated 实测留屏。

`build` 重建成功。`up` 输出 isolated、非零显示组、当前虚拟设备 CAMERA `after=0` 且已授予，启动器返回成功。首次启动器持续停在启动画面约一分钟；结束虚拟显示后在物理屏幕打开首页，再次 `up` 将已有任务移入虚拟屏幕：立即截图曾报“虚拟屏幕尚无画面”，稍后截图出现首页；最终一次 `up` 后完成扫码。该现象不证明拒绝虚拟显示，原始输出和截图见 `up.txt`、`stalled.png`、`up-retry.txt`、`retry-stop.png`、`up-third.txt`。`down` 成功保存主机日志并移除 association。

| 判据 | 结果与证据 |
| --- | --- |
| 关卡 5：活动与相机 | 扫码活动在 display 5，最新支付宝 CONNECT 为虚拟相机 `v4_1003`，`status` 显示 streams=1；见 `scan-activities.txt`、`scan-camera.txt`、`scan-status.json`。 |
| 关卡 5：交付帧及业务反应 | 已知码 `android-qr-bridge:gate2:2026-11-15` 送入后，同轮 `capture-frame` 交付 640×480 帧，电脑 ZXing 解出相同原文；支付宝显示原文和“该内容非支付宝提供 请谨慎使用”。见 `capture.json`、交付帧和 `decode.txt`、`known-later.json`／截图。 |
| 关卡 6：识别登录码 | **通过。** 独立 ego-lite task-space 打开支付宝登录页，截取二维码并补白，放大后电脑 ZXing 解码成功，送入虚拟相机。见 `web-480.png`、`web-qr-480.png`、`web-decode-480.txt`。 |
| 关卡 6：进入确认页 | **通过。** 手机显示“即将在电脑上登录”“请确认是否本人操作”，核对后点“确认登录”；见 `web-scan-result.json`／截图。 |
| 关卡 6：网页端已登录 | **通过。** 网页进入已登录的支付宝商家平台，随后点击退出登录，页面显示登录入口，关闭独立 task-space；见本地 `web-logged.png`。 |

开始和结束时原生无线调试均开启、配对保留，传统 TCP 两项属性均为空，转发列表一致且为空；原有 companion association 保留，没有残留虚拟设备或手机实验目录。`down-final.txt`、`virtual-final.txt`、`companion-final.txt`、`remote-final.txt` 和前后基线文件记录清理。支付宝重新在 display 0 打开首页，仍处于登录状态；见 `physical-final-activities.txt` 和截图。没有提交 Git。
