# 0.2.0 构建交付记录

2026-11-17，包名 `dev.qrbridge.wake`，versionCode 2。产物：`/Users/clawdbot/aimobile/qrbridge/.local/artifacts/qrbridge-wake-0.2.0.apk`。

## 变更

- 按钮首先连接本机 5555；已有监听直接显示「5555 已在运行」，跳过 Wi-Fi、配对、grant 和无线调试设置。
- `BOOT_COMPLETED` 安排一个 Wi-Fi 约束的系统 `JobScheduler` 任务。首次有 Wi-Fi 时执行一次；不用前台常驻服务、唤醒锁或轮询，不新增依赖。收到系统停止回调时中断执行，且不重排；完成／失败后等待手动操作或下次重启。
- 按钮与后台共用同一恢复逻辑，串行执行，避免两者同时修改临时开关。仅关闭本次临时开启的无线调试；成功、异常和中断均执行清理。完成清理后再次核实 5555，仍可连接才报告成功。
- 后台结果只发一条短中文通知；Android 13+ 首次打开新版时申请通知权限。拒绝通知仍执行恢复，不反复申请。vivo 自启动需用户手动允许，已写入 README。
- 统一缩短中文提示。mDNS 等待超时时显示「等待超时。请允许此网络调试，再点开启」，释放忙状态，允许第二次点击继续。
- 保留同一 debug 签名和私有身份路径，覆盖升级不清除已有配对；清除了旧构造函数中重复的 API／超时赋值，实际认证等待仍为原有 10 秒。

## 验证

- `./wake/build.sh`：`testDebugUnitTest`、`lintDebug`、`assembleDebug` 通过；Gradle 9.6.0／AGP 9.4.0／JDK 25，目标 Android 16 API 36。
- 9 项单元测试通过。新增 6 项覆盖：已有监听时无任何前置检查或设置写入、无 Wi-Fi 不写设置、无 grant 的手动／后台分流、仅恢复自己打开的开关、失败和中断清理、网络许可超时后的第二次点击；保留原有 3 项 TCP 切换结果判定测试。
- `scripts/agent-check diff`、`git diff --check` 通过。round14 的现有监听错误提示和新网络超时文字已从原始 UI 证据核对，作为本次回归依据。
- `apksigner verify --verbose` 通过（v2 签名）。`aapt2` 确认版本 0.2.0、API 30–36，最终权限仅为 `INTERNET`、`ACCESS_NETWORK_STATE`、`WRITE_SECURE_SETTINGS`、`RECEIVE_BOOT_COMPLETED`、`POST_NOTIFICATIONS`；`BIND_JOB_SERVICE` 是服务入口保护，不是应用申请权限。
- APK 约 10.3 MiB，新功能增加不足 0.1 MiB；无新 SDK，继续使用 LibADB Android BC 3.5.1 和既有 Bouncy Castle 依赖。许可继续随 APK 提供。

日志：`.local/wake/build-0.2.0.log`、`.local/wake/agent-check-0.2.0.log`；测试结果 `.local/wake/build/test-results/testDebugUnitTest/`，lint 报告 `.local/wake/build/reports/`。只修改 `wake/` 和根 README 的唤醒应用小节；未提交，未连接或操作手机。

## 手机验收与限制

- round14 已通过 0.1.0 的配对、grant、重启后手动恢复和蜂窝网络连接；**0.2.0 开机后台、新通知、端口优先与恢复开关行为尚未实机验证**，按 [TEST_PLAN.md](TEST_PLAN.md) 交给手机 worker。
- 系统调度、应用后台限制和 vivo 自启动策略可能推迟或阻止运行；vivo 需用户允许本应用自启动。应用必须至少打开一次、已配对并持有 grant。通知也需用户允许，构建 worker 未替用户授权任何权限。
- Wi-Fi 约束不要求 `INTERNET` 或 `VALIDATED` 能力，支持热点与无外网的 Wi-Fi；系统仍可依据调度策略推迟执行。[JobInfo 网络约束](https://developer.android.com/reference/android/app/job/JobInfo.Builder#setRequiredNetwork(android.net.NetworkRequest))；Android 16 [ConnectivityController](https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-16.0.0_r1/apex/jobscheduler/service/java/com/android/server/job/controllers/ConnectivityController.java) 的可用性检查要求网络非挂起，未强制互联网验证。
- 未信任的新 Wi-Fi 仍需用户接受系统网络调试提示，应用不绕过。超时后发原因通知且结束本次自动尝试，接受后可手动再点。
- 代码在正常结果、异常和线程中断时恢复临时开关；系统直接杀进程时不能保证 finally 有机会运行，没有额外持久化恢复／重试机制。
- 原配对库无可配置读取超时的风险仍在；未改动已实机通过的配对／TLS 库。lint 无错误，保留第三方自签名 TLS、固定版本、备份规则和中文常量提示。
- 自动恢复的是端口。Tailscale 本身是否开机在线独立于本应用，round14 中该机重启后需要手动重新连接 Tailscale；本次不操作 VPN 设置。
