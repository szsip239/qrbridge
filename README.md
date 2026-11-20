# 安卓二维码虚拟摄像头原型

**真机已通过关卡 1–4；round5 已观察到微信连接虚拟相机、识码与网页登录，round6 补齐交付帧内容自证。** 扫码预览的空控件树属于正常现象；验收证据、边界与恢复情况见 [RESULTS.md](RESULTS.md)。这是实验原型。

## 组成与依赖

- `src/BridgeHost.java`：shell 身份的 `app_process` 常驻主机，经虚拟设备创建 public、受信任、独立显示组的虚拟屏幕和后置摄像头。屏幕 720×1280／240 dpi，相机输入 640×480 RGBA_8888／30 FPS／传感器方向 0°。图片等比居中，周围补白。
- `bridge.py`：仅依赖 Python 标准库与现有 `adb`，USB 或无线连接均由 ADB 提供。每次协议请求临时建立本机转发，结束后移除。
- `src/ProbeActivity.java`：仅申请 CAMERA 权限的自建探针。Camera2 用 YUV_420_888 图像读取器解码；Camera1 用 NV21 预览回调解码。按钮切换 API、“点击计数”验证同屏操作，子活动按钮验证跨任务启动；标题显示活动名、display、device 与 task 编号。
- `src/CameraInventory.java`：在同一个 shell UID 下对照默认设备与当前虚拟设备的 Camera2 枚举，不打开相机。
- 构建依赖 JDK 17 以上、Android SDK `platforms/android-36` 与 `build-tools/36.0.0`。SDK 默认 `~/Library/Android/sdk`，可用 `ANDROID_HOME` 指定。
- 探针首次构建下载 [ZXing core 3.5.3](https://repo.maven.apache.org/maven2/com/google/zxing/core/3.5.3/core-3.5.3.jar)，许可证见 [ZXing LICENSE](https://github.com/zxing/zxing/blob/zxing-3.5.3/LICENSE)。未引入第三方扫码 APK。

从仓库根目录运行。产物、实验签名密钥、图片和证据均位于 Git 忽略的 `.local/`。

## 日常扫码入口

已构建主机、手机已连接时，三步完成一次扫码；多台设备时先 `export ANDROID_SERIAL=...`，`adb` 和本 CLI 都按它选设备。

```sh
python3 bridge.py up com.tencent.mm
python3 bridge.py image 二维码.png
python3 bridge.py down .local/host.txt
```

`up` 依次执行 `start`、等待日志出现 `READY`（30 秒超时并附原始日志）、`status`、`grant-camera`，再用该包的启动器活动在虚拟屏幕 `launch`，一次输出全部结果。之后在虚拟屏幕进入 App 的扫一扫；码过期就重新 `image`。`down` 先保存主机日志，再 `stop` 并删除手机端临时目录。上次未清理的 association 仍会让 `up` 报错，此时先 `stop`。

## DSH 卡片

`dsh/` 是 DSH 插件 `@qrbridge/dsh-qrbridge`，规格与切片见 issue #1。能力 `qrbridge.bridge` 的动作都调用本仓库 `bridge.py`：

| 动作 | 作用 |
| --- | --- |
| `qrbridge.status`、`qrbridge.up`、`qrbridge.down` | 主机状态、为微信／支付宝启动（返回虚拟屏幕上打开的活动，vivo 双开选择框需在手机画面选原版）、结束并保存日志 |
| `qrbridge.scan` | 截取卡片透明取景框下的屏幕区域并 `image` 送入虚拟相机 |
| `qrbridge.screen`、`qrbridge.tap`、`qrbridge.back` | 读取虚拟屏幕画面、按画面坐标点击、返回键 |

卡片 `qrbridge.scan` 声明 `uiHints.windowBackground: "transparent"`，须开成置顶 Widget Window 使用：取景框坐标加上 `@mosaic/dsh-native-probe` 提供的 `mosaicNativeSurfaces.widgetWindowFrame` 得到屏幕区域，由 `/usr/sbin/screencapture` 截取，DSH 需要 macOS“屏幕录制”权限。依赖 OpenKanban 的透明 Widget Window 与窗口坐标改动，尚未随 Host 发布。插件配置：

```yaml
- id: qrbridge
  config:
    bridge: /绝对路径/bridge.py
    logDir: /绝对路径/日志目录   # down 保存主机日志的位置
    serial: 可选的 ADB 设备标识
```

`cd dsh && npm pack` 生成安装包，在开发实例按 `dsh plugin --profile <名称> add <tgz>` 安装；稳定桌面只经 `dsh-deploy` 部署。测试：`cd dsh && npm test`。

## 构建与首次运行

```sh
python3 bridge.py build
python3 bridge.py build-probe
adb devices
```

`build` 生成 `.local/build/bridge.jar`。`build-probe` 生成同目录的 `probe.apk`、`known-qr.png` 及实验签名密钥。已知码原文为 `android-qr-bridge:gate2:2026-11-15`。

选择设备后，可把其 ADB 标识保存在本机环境变量。以下 `ANDROID_SERIAL` 接受 USB 序列号或无线 `ip:port`，不写进仓库。

```sh
python3 bridge.py --serial "$ANDROID_SERIAL" install-probe
python3 bridge.py --serial "$ANDROID_SERIAL" start
python3 bridge.py --serial "$ANDROID_SERIAL" log
python3 bridge.py --serial "$ANDROID_SERIAL" status
python3 bridge.py --serial "$ANDROID_SERIAL" grant-camera local.qrbridge.probe
python3 bridge.py --serial "$ANDROID_SERIAL" image .local/build/known-qr.png
python3 bridge.py --serial "$ANDROID_SERIAL" launch local.qrbridge.probe/.ProbeActivity
```

`--serial` 放在子命令前；省略时由 `adb` 选择唯一设备。手机出现安装提示时，先核对应用名“二维码桥接探针”或包名 `local.qrbridge.probe`，再确认本次安装。存在并行安装时，不确认其他 App 的提示。本次 vivo 要求勾选风险提示并点“继续安装”，无需修改安全设置。

`start` 只返回后台进程 PID，**不表示初始化完成**。先用 `log` 核对已出现 `READY`，再调用 `status`；启动过早的协议请求可能直接失败。主机使用 `nohup`、后台运行和标准输入输出重定向，不依附启动它的 adb shell。手机端文件位于 `/data/local/tmp/android-qr-bridge/`，原始日志为 `host.log`。

## 按虚拟设备授权

**默认设备的 CAMERA 已授予，不代表当前虚拟设备也已授予。** 自定义相机策略按虚拟设备的 `persistent_device_id` 保存权限。本次已真机证实：该设备上从 `-1` 授权到 `0` 后，探针成功打开虚拟相机。

```sh
python3 bridge.py --serial "$ANDROID_SERIAL" camera-permission "$TARGET_PACKAGE"
python3 bridge.py --serial "$ANDROID_SERIAL" grant-camera "$TARGET_PACKAGE"
```

`camera-permission` 查询指定包在当前虚拟设备上的 CAMERA。`grant-camera` 以 shell 身份调用 `IPermissionManager.grantRuntimePermission(packageName, permissionName, persistentDeviceId, userId)`，并返回 `before`、`after`、`granted`、持久 ID 和用户编号。当前实现针对用户 0；目标包须已声明 CAMERA 运行时权限，系统拒绝时直接返回原始异常。

association 删除重建后，持久 ID 改变，**必须重新查询和授权**。`install-probe` 授予的是默认设备权限，不能替代上述步骤；对其他包执行默认设备授权不属于这条命令的行为。

探针的授权框观察方式如下，仅用于复现实验，不能代替 shell 授权步骤：

```sh
adb -s "$ANDROID_SERIAL" shell am force-stop local.qrbridge.probe
# DISPLAY_ID 取自 status；此时该虚拟设备上应尚未授权。
adb -s "$ANDROID_SERIAL" shell am start -W --display "$DISPLAY_ID" \
  -n local.qrbridge.probe/.ProbeActivity --ez request_camera true
```

必须先结束旧探针进程，观察参数在 `onCreate` 中读取。本次未预授权时出现了明确针对虚拟设备的权限框，但框在物理主屏，探针任务也被移到主屏；只观察后结束探针，没有点击允许。该现象发生在早期 private 虚拟显示配置下，未对最终 public 配置重复该观察。

## 命令参考

每条命令均可带 `--serial`。

| 命令 | 参数与效果 |
| --- | --- |
| `build` | 构建主机 JAR，不连接手机。 |
| `build-probe` | 构建探针 APK 与已知二维码，不安装。 |
| `install-probe` | 使用普通 APK 安装流程安装探针，再授予其默认设备 CAMERA；更新已装探针时自行用 `adb install --no-incremental -r`。 |
| `start [--display-mode isolated\|trusted\|legacy]` | 默认 `isolated`，受信任独立显示组；另两种供对照诊断。推送并后台启动主机，创建本原型专用 shell／APP_STREAMING association；同一手机只运行一份。 |
| `up 包名 [--display-mode ...]` | 组合 `start`、等待 READY、`status`、`grant-camera` 与启动器 `launch`，见“日常扫码入口”。 |
| `down 日志路径` | 保存主机日志，`stop`，删除手机端临时目录。 |
| `status` | 返回 PID、虚拟设备编号、持久 ID、显示编号、显示组编号、模式、实际 Display flags、相机 ID、已配置流数、图片是否已加载。 |
| `log` | 读取手机端原始主机日志。 |
| `camera-permission 包名` | 查询当前虚拟设备上的 CAMERA 状态。 |
| `grant-camera 包名` | 授予指定包当前虚拟设备上的 CAMERA，返回授权前后状态。 |
| `cameras` | 推送只读枚举辅助程序至同一临时目录，对照默认／虚拟设备相机列表，不打开相机。 |
| `image 图片路径` | 提交 PNG／JPEG；相机请求帧时画入其 Surface。提交成功不能替代 App 内取景验收。 |
| `capture-frame 输出目录` | 对下一次相机请求留证，保存带时间戳的实际交付帧 PNG 与同名 JSON；先启动相机消费方。 |
| `launch 包名/Activity` | 用 `am start -W --display` 在当前虚拟屏幕启动组件，不结束已有任务。 |
| `screenshot 输出.png` | 保存该虚拟屏幕的 ImageReader 画面；没有画面直接报错。 |
| `tree 输出.json` | 保存同一显示的 UiAutomation 控件树，含文字、类名、控件 ID、坐标和子节点。 |
| `tap x y` | 用系统 `input -d` 点击该虚拟屏幕坐标。 |
| `text 文字` | 用 `input -d ... text` 输入，中文仍受系统 input 限制，`%s` 表示空格。 |
| `key 按键名或编号` | 用 `input -d ... keyevent` 发送按键，例如 `KEYCODE_BACK`。 |
| `stop` | 请求主机释放资源，移除本原型 association；主机已退出时清理剩余 association。 |

```sh
python3 bridge.py status
python3 bridge.py cameras
python3 bridge.py screenshot .local/evidence/screen.png
python3 bridge.py tree .local/evidence/tree.json
python3 bridge.py tap 338 80
python3 bridge.py text 'hello%sworld'
python3 bridge.py key KEYCODE_BACK
```

点击前先读树或截图，不能假定控件位置始终不变。虚拟屏幕左上角为原点；启动动画期间的控件坐标可能还在变化。本次已验证截图、读树、坐标点击；`text` 和 `key` 尚未单独验收。

相机 API 中的 `0` 可以是该虚拟设备映射后的相机 ID，与 `media.camera` 中的 `v...` 标识不同。App 已在主屏运行时，定向启动可能迁移原任务；本次探针的同一个任务和 Activity 实例从主屏移入虚拟屏幕，没有产生独立副本。不要据此推断所有业务 App 都相同。

## 一次性交付帧留证

前置条件：主机 READY、已用 `image` 送入图片、消费方已打开虚拟相机，`status` 的 `streams` 大于 0。探针验证时从主活动点击 `SINGLETASK 竖屏`，确认子活动标题和 Camera2 解码原文后执行：

```sh
python3 bridge.py --serial "$ANDROID_SERIAL" \
  capture-frame .local/round6
```

命令等待下一次 `onProcessCaptureRequest`，不取流配置时的初始画面。留证这一帧先按相机 Surface 的实际尺寸，用相同的等比居中、补白函数合成位图，再将**这张位图本身**原尺寸画入该 Surface；`unlockCanvasAndPost` 成功后将同一位图编码为 PNG 返回电脑。由此保留的是交付路径上的缩放与补白结果。其余请求继续直接绘制，不持续生成位图或 PNG；手机端没有新增留证文件。

成功返回 `path`、`metadata_path`、UTC 时间、毫秒时间戳、`stream_id`、`frame_id`、相机 ID、显示编号和实际宽高。输出文件名为 `delivered-毫秒时间戳-s流编号-f帧编号.png`，同名 JSON 保存这些元数据。没有消费流立即报错；已有流但 10 秒内没有新请求则报超时，不导出旧帧。

验收时在电脑端用 ZXing 解码该 PNG，并核对消费方 Camera2 从 YUV_420_888 帧解出的原文；同一原文是内容一致判据，RGBA 与 YUV 存在格式转换。round6 的源图为 360×360，交付帧为 640×480，码图等比放大到 480×480、左右各补白 80 像素；两端均解出 `android-qr-bridge:round6:2026-11-15`。证据文件及清理结果见 RESULTS 的 round6 节。

## 扫码预览与空控件树

**扫码活动控件树为空是相机预览的正常现象，不是本次缺陷。** 微信扫一扫的 SurfaceView 预览像素没有可读文字节点，预览层也可能不出现在虚拟显示截图中。空树或缺失预览的截图不能单独说明活动迁屏或相机断流。

端到端验收以四项证据连接：系统活动转储与监听确认扫码活动的显示落点；`dumpsys media.camera` 确认微信 `CONNECT device v...`；一次性交付帧可解出本次送入内容（由 Camera2 探针验证这条交付链）；网页实际进入已登录页面。round5 已保存前三项中的活动与 CONNECT、业务识码及网页登录，round6 补齐通用交付机制的帧内容证据；round5 当时没有留交付帧文件，本轮也未重新操作微信。验收不依赖扫码活动有可读控件树。

## 扫码类子活动与显示策略（round4）

旧配置没有 `TRUSTED`，显示属于 group 0。shell 能通过 `am start --display` 启动主活动，但普通 App 再启动未声明 `allowEmbedded` 的子活动会受系统限制；本机探针的 `singleInstance`、`NEW_TASK`、`singleTask`＋固定竖屏均复现回物理屏幕、连接相机 `0`。只增加 `TRUSTED` 已让这三种方式留在虚拟设备上，并从虚拟相机解出已知码。

默认 `isolated` 在 `PUBLIC | OWN_CONTENT_ONLY` 上增加 `TRUSTED | OWN_DISPLAY_GROUP | ALWAYS_UNLOCKED`。实际调用仍是 `VirtualDevice.createVirtualDisplay`；活动策略明确为 `POLICY_TYPE_ACTIVITY=DEVICE_POLICY_DEFAULT`（允许启动），相机策略为 CUSTOM。活动监听在 `log` 中输出 `ACTIVITY onTopActivityChanged`、`onDisplayEmpty` 等事件。允许启动的策略不会强制覆盖 App 显式指定的启动显示。

本机 shell 已具备 `ADD_TRUSTED_DISPLAY` 与 `ADD_ALWAYS_UNLOCKED_DISPLAY`，无需 root 或系统签名 APK。`ALWAYS_UNLOCKED` 仅用于这块虚拟显示，未更改手机锁屏设置；新配置下的锁屏行为未重测。其他手机须先核对权限；拒绝时原始异常会出现在 `log`，没有自动降级。显示编号由系统分配，不能固定为前轮的 18：round4 的旧配置为 19，trusted 为 20，isolated 为 21。

探针启动、授权与送图后，先读 `tree`，再按实际按钮坐标点击。每个子活动复用相同 Camera1／Camera2 取景解码界面：

| 主活动按钮 | 子活动启动方式 | round4 默认模式结果 |
| --- | --- | --- |
| `SINGLEINSTANCE` | `singleInstance`，可缩放 | display 21，连接 `v9_1008`，应用内解码通过。 |
| `NEW_TASK` | 新 taskAffinity＋`FLAG_ACTIVITY_NEW_TASK` | 同上。 |
| `SINGLETASK 竖屏` | `singleTask`＋固定 portrait＋可缩放，与微信扫码属性相近 | 同上。 |
| `不可缩放竖屏` | `resizeableActivity=false`＋portrait＋新任务 | 同样通过；本机不支持“固定方向或不可缩放必定回主屏”的推断。 |
| `显式 DISPLAY 0` | `ActivityOptions.setLaunchDisplayId(0)` | 负对照：子活动在物理 display 0、连接真实相机 0；策略不能把它强制留回虚拟设备。 |

本机复现脚本在 `.local/round4/run_case.py`。它结束旧探针、定向启动主活动、按读取到的按钮坐标打开子活动，保存截图、树、任务与相机转储并断言子活动留屏和解码；须先启动主机、为探针授权并送入已知码。例如：

```sh
python3 .local/round4/run_case.py \
  .local/round4/recheck-singleinstance singleInstance SingleInstance
```

round4 只对微信做只读属性与系统事件查询。微信 8.0.80 的 `BaseScanUI` 为 `singleTask`、portrait、`RESIZE_MODE_RESIZEABLE`、taskAffinity=`com.tencent.mm`，允许远程显示，但未声明 `allowEmbedded`。因此旧显示的信任属性是有实证支持的根因；没有发现必须 root 才能解决的活动属性。后续 round5 已复测扫码活动留在 display 22 并连接虚拟相机，详见 RESULTS。

## 无线运行与恢复

**本轮通过的是：已有 USB 授权 → 用 USB 开启传统 ADB TCP → 重跑与主机启动均通过 Wi-Fi。** USB 线仍连接供电，但验证阶段所有推送、送图和操作都显式选择无线标识。无线 transport 实际断开约 15 秒后重连，PID、虚拟设备、相机和显示保持，继续送新图、解码、读树及点击成功。

先记录原有 `service.adb.tcp.port`、`persist.adb.tcp.port`、`adb_wifi_enabled` 和 ADB 连接列表，再按本机变量执行：

```sh
adb -s "$USB_SERIAL" tcpip 5555
adb connect "$WIRELESS_SERIAL"
python3 bridge.py --serial "$WIRELESS_SERIAL" start
python3 bridge.py --serial "$WIRELESS_SERIAL" log
python3 bridge.py --serial "$WIRELESS_SERIAL" status
# 随后 grant-camera、image、launch、tree、screenshot、tap 均显式使用该无线标识。
adb disconnect "$WIRELESS_SERIAL"
adb connect "$WIRELESS_SERIAL"
python3 bridge.py --serial "$WIRELESS_SERIAL" status
```

手机需要已开启开发者选项／USB 调试，电脑已被认可，Wi-Fi 与电脑网络互通；本次没有关闭 VPN，没有打开 Android 的“无线调试”开关，也没有新建 TLS 配对。

**本轮没有证明重启后零 USB 启动。** 手机重启会结束主机；传统 TCP 方式是否保留端口开关未重启测试，应准备重新激活与启动。完全无 USB 时，可另按 [Android 官方无线调试流程](https://developer.android.com/tools/adb#connect-to-a-device-over-wi-fi)开启手机“无线调试”、通过 `adb pair` 配对并 `adb connect`，然后复用本 CLI；该入口本轮未实测，连接端口也不应假定为 5555。

测试结束，先清理实验，再按开始时状态恢复监听。本次开始时没有 TCP 监听，因此最后执行：

```sh
python3 bridge.py --serial "$WIRELESS_SERIAL" stop
adb -s "$WIRELESS_SERIAL" uninstall local.qrbridge.probe
adb -s "$WIRELESS_SERIAL" shell rm -r /data/local/tmp/android-qr-bridge
adb -s "$WIRELESS_SERIAL" usb
adb disconnect "$WIRELESS_SERIAL"
```

本次恢复后确认 5555 没有 LISTEN，持久 TCP 属性为空，无线调试仍为 0。若开始时已有其他监听设置，应恢复实际原状态，不照抄关闭命令。

## 清理与证据

普通连接下的清理：

```sh
python3 bridge.py log > .local/evidence/host-final.txt
python3 bridge.py stop
adb shell dumpsys virtualdevice
adb uninstall local.qrbridge.probe
adb shell rm -r /data/local/tmp/android-qr-bridge
```

多设备时指定对应标识。只卸载本次新装的探针，不动已有 App；删除临时目录前先取日志。不要使用 `disassociate-all`。CLI 没有创建过 PID 文件时，`stop` 会显示该错误，需先依据实际状态处理。

## 参考来源

按公开系统 API 独立实现，没有读取或复制 AndroMeldDesktop3rd 源码。AOSP 与 scrcpy 均为 Apache 2.0：

- [VirtualDeviceManager](https://github.com/aosp-mirror/platform_frameworks_base/blob/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/companion/virtual/VirtualDeviceManager.java)、[VirtualCameraConfig](https://github.com/aosp-mirror/platform_frameworks_base/blob/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/companion/virtual/camera/VirtualCameraConfig.java)、[VirtualCameraCallback](https://github.com/aosp-mirror/platform_frameworks_base/blob/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/companion/virtual/camera/VirtualCameraCallback.java)
- [IPermissionManager 按设备授权与查询签名](https://github.com/aosp-mirror/platform_frameworks_base/blob/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/permission/IPermissionManager.aidl#L68)、[PermissionManager 实现](https://github.com/aosp-mirror/platform_frameworks_base/blob/99b01a65cc4c104933788b3143285ab6bae65827/core/java/android/permission/PermissionManager.java#L663)
- [AccessibilityManagerService 对 private 虚拟显示的过滤](https://github.com/aosp-mirror/platform_frameworks_base/blob/99b01a65cc4c104933788b3143285ab6bae65827/services/accessibility/java/com/android/server/accessibility/AccessibilityManagerService.java#L5641)
- [ActivityTaskSupervisor 对不受信任显示的活动启动检查](https://github.com/aosp-mirror/platform_frameworks_base/blob/99b01a65cc4c104933788b3143285ab6bae65827/services/core/java/com/android/server/wm/ActivityTaskSupervisor.java#L1147)、[DisplayManagerService 对信任、显示组与解锁标志的处理](https://github.com/aosp-mirror/platform_frameworks_base/blob/99b01a65cc4c104933788b3143285ab6bae65827/services/core/java/com/android/server/display/DisplayManagerService.java#L1725)
- [CTS VirtualCameraTest](https://android.googlesource.com/platform/cts/+/refs/heads/main/tests/tests/virtualdevice/camera/src/android/virtualdevice/cts/camera/VirtualCameraTest.java)、[scrcpy shell 上下文](https://github.com/Genymobile/scrcpy/blob/a60891aea193d92e7e5c3942700eca63f9d19a5f/server/src/main/java/com/genymobile/scrcpy/FakeContext.java)
