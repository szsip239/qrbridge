# 5555 唤醒

包名 `dev.qrbridge.wake`，Android 11+，当前版本 0.2.0。按钮先查本机 5555：已运行就显示「5555 已在运行」，无需 Wi-Fi，也不改设置。未运行时通过本机已配对的无线调试发送 `tcpip:5555`，确认监听后显示「成功」。

## 构建

需要 JDK 25、Android SDK `platforms;android-36`，首次构建需联网下载 Gradle 和依赖。

```sh
./wake/build.sh
```

使用 Gradle 9.6.0、AGP 9.4.0；脚本执行单元测试、Android lint 和 debug 构建，只构建，不连接手机。可用 `ANDROID_HOME`、`JAVA_HOME`、`GRADLE_BIN` 指定工具。产物为 `.local/artifacts/qrbridge-wake-0.2.0.apk`；缓存、日志和签名密钥均在忽略目录 `.local/wake/`。保留同一签名密钥，才能覆盖更新且保留原配对。

## 首次设置与升级

由用户或获授权的手机 worker 安装。以下命令由测试者执行，不是构建步骤。

```sh
adb -s "$USB_SERIAL" install --no-incremental -r .local/artifacts/qrbridge-wake-0.2.0.apk
# 开机自动恢复需要此权限；已授予过且覆盖升级时无需重授。
adb -s "$USB_SERIAL" shell pm grant dev.qrbridge.wake android.permission.WRITE_SECURE_SETTINGS
```

首次打开应用，允许「通知」，用于接收开机恢复结果。**vivo 需要在系统应用管理中允许本应用「自启动」**；应用不会自行修改该设置。关闭通知不影响恢复，但不会看到结果通知。

首次配对：连接任意 Wi-Fi，在系统开启「无线调试」并允许此网络。把系统设置与本应用分屏，系统进入「使用配对码配对设备」，应用菜单进入「首次配对」，输入系统弹窗的**配对端口**和六位码。保持弹窗打开，直到显示「配对成功」。无需输入地址。

0.1.0 已配对的安装覆盖更新后保留配对和调试开关权限，不必重配。卸载、清数据或系统撤销配对后，需从菜单重配。私钥和证书保存在应用私有且不参与备份的目录，配对码不保存。

## 开机自动恢复

手机重启并首次解锁后，收到 `BOOT_COMPLETED` 就安排一次系统后台任务；等待任意 Wi-Fi（包括别人的热点），无需打开应用或点按钮。任务需要已有配对与 `WRITE_SECURE_SETTINGS`。

任务先查 5555；未运行时，按按钮相同的步骤临时开启无线调试、连接本机 TLS、开启 5555。**原先无线调试是关闭的，操作结束时会关回去；原先开启则保持开启。** 成功或失败均发一条短通知，随后结束本次开机任务，不循环重试。若系统因网络丢失等原因停止任务，也会通知并结束，等手动点按钮或下次重启。按钮确认 5555 已运行后会取消待执行的开机任务。

系统「允许此网络调试」仍需用户同意。若等超时，显示「等待超时。请允许此网络调试，再点开启」；允许后再点即可。Android 的任务调度和 vivo 后台限制可能推迟执行，实际开机行为按 [手机验收计划](TEST_PLAN.md) 核实。系统 [开机广播](https://developer.android.com/develop/background-work/background-tasks/broadcasts/broadcast-exceptions) 和 [Wi-Fi 网络约束任务](https://developer.android.com/reference/android/app/job/JobInfo.Builder#setRequiredNetwork(android.net.NetworkRequest)) 是本实现的后台入口。

## 手动使用

点「开启 5555」。已有监听时立即显示「5555 已在运行」；否则需连接 Wi-Fi。未授予调试开关权限且无线调试关闭时，打开设置，手动开启后回来再点。已授予权限时自行开启，用完按原状态关闭。无监听又无 Wi-Fi 时显示「请先连接任意 Wi-Fi（包括别人的热点）」。只开启本手机自己的热点不算连接 Wi-Fi。

成功后可关 Wi-Fi、拔 USB，保持 USB 调试设置和 Tailscale 在线；Mac 执行 `adb connect "$PHONE_TAILNET:5555"`。本应用不控制 Tailscale；round14 中该机重启后还需重新连接 Tailscale。传统 5555 是通配监听，沿用系统 ADB 公钥授权；Tailscale 仅加密经过隧道的流量，不限制其他接口访问监听端口。

## 实现与边界

- 使用 [LibADB Android BC 3.5.1](https://github.com/osservatorionessuno/libadb-android-bc/tree/3.5.1)（提交 `b6c301dab4b83ae5892a7e68fdb96b6554e046a8`，Apache-2.0，部分文件另附 BSD/MIT 通知），配对使用 Bouncy Castle 1.84，无 JNI 或隐藏 API。保留 0.1.0 的配对和连接库，没有新 SDK 或后台框架依赖。
- 最低 API 30，目标／编译 API 36。round14 已验收 0.1.0 在此 vivo Android 16 的配对、grant、重启后手动恢复和蜂窝网络连接；0.2.0 新增开机任务和恢复开关行为尚待手机验收。
- 用 `NsdManager` 发现本机 `_adb-tls-connect._tcp`，地址限定本机网卡；连接固定为 `127.0.0.1`。不扫描其他主机、不保存端口、不用 shell 改属性。
- 权限仅有 `INTERNET`、`ACCESS_NETWORK_STATE`、`WRITE_SECURE_SETTINGS`、`RECEIVE_BOOT_COMPLETED`、`POST_NOTIFICATIONS`。JobService 由系统调度；没有前台常驻服务、唤醒锁、精确闹钟、轮询守护或分析 SDK。
- mDNS 等待 15 秒、ADB 认证等待 10 秒，切换 TCP 后最多等约 10 秒。TLS 可能因 adbd 重启提前关闭，仍以 5555 实际可连接判成功。配对库仍没有可配置的读取超时，配对卡住时需结束应用再开。
- 私钥是应用沙箱内的 PKCS#12 文件；库需要可编码 RSA 私钥，未使用硬件密钥库。只修改无线调试开关和临时 5555 监听，不改变其他系统或安全设置。正常完成、异常和任务中断均执行开关恢复；系统强制终止进程无法保证清理代码有机会运行。

现场基线见 [RESULTS round14](../RESULTS.md)，构建证据见 [BUILD_REPORT.md](BUILD_REPORT.md)。
