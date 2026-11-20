# Android 16 关闭 Wi-Fi 后经 Tailscale 连接 ADB：平台机制与可行路线

**结论：Android 16 的原生 Wireless debugging 没有受支持的“纯蜂窝网络、Wi-Fi 关闭、长期保持 TLS ADB”模式。** 限制来自系统框架对已连接 Wi-Fi 和可信接入点的检查，不是 adbd 只能绑定 Wi-Fi 地址；TLS 服务器实际上使用通配地址监听。Wi-Fi 有效且 Wireless debugging 保持开启时，经 Tailscale 地址接入在源码层面成立；关闭 Wi-Fi 后框架会关闭该服务器，因此不能靠换成 Tailscale 地址继续维持。[Settings 开关检查][ui16]、[框架开启检查][enable16]、[Wi-Fi 断开处理][receiver16]、[TLS 监听实现][tls16]。

**对本案例最实际的路线是传统 `adb tcpip 5555`，每次手机重启后重新引导一次，同一开机周期内经 Tailscale 使用。** 引导既可来自 USB，也可来自已经配对的 Wireless debugging 连接；随后可关闭 Wi-Fi、拔掉 USB。任务提供的 2026-11-16 现场记录已验证后一阶段的纯蜂窝网络连接，但没有验证跨手机重启自动恢复。若要求“每次重启也无需 USB”，可以在手机暂时连接 Wi-Fi 时用本机 ADB 客户端重新开启传统端口；完全没有 Wi-Fi、USB 且没有存活的特权进程时，本次未找到 AOSP 支持的通用启动路线。实验性工具例外见后文，尚未在本机验证。[传统端口服务][restart16]、[端口启动读取][main16]、[传统 TCP 与 TLS 的区别][architecture]。

研究日期：2026-11-17。研究类型：外部对象研究，研究 Android／ADB／Tailscale 的公开机制，可独立于本项目使用。仅读取 AOSP、Android 官方文档、Tailscale 官方资料和工具上游源码；没有连接手机、运行 adb 或修改电脑／手机设置。现场记录仅作为任务提供的既有观察，以下“源码判断”“推断”“本机已验证”“未验证”分别标注。

## 1. 版本边界

不能只用“Android 16”概括所有构建。本次核对了不可变标签 `android-16.0.0_r1`、`r2`、`r3`、`r4`：前三者的相关网络关闭逻辑仍位于 `AdbDebuggingManager` 广播接收器；`r4`（也核对了 `android16-qpr2-release` 分支）的重构增加 `AdbWifiNetworkMonitor`，但通过 `allowAdbWifiReconnect()` 功能开关选择新监控或旧 `AdbBroadcastReceiver`。因此，看到新类存在不能认定某台手机已经启用了它。本任务没有提供 OEM 构建标识和开关状态，也未读取设备来确认。[r1][receiver16]、[r2][manager2]、[r3][manager3]、[r4 构造函数分支][monitorchoice]、[功能开关声明][flags16]。

| 已核对的源码版本 | 开启的必要检查 | Wi-Fi 丢失／变更后的处理 |
| --- | --- | --- |
| Android 11 `android-11.0.0_r1` | 有效 Wi-Fi 接入信息、可信 BSSID 或用户同意 | 广播接收器把 `adb_wifi_enabled` 改为 0。[Android 11 实现][manager11] |
| Android 15 `android-15.0.0_r1`；Android 16 `r1`～`r3` | 同类检查；Wi-Fi 开关打开但未连接也不够 | 关闭 Wi-Fi、断连、BSSID 无效或更换，均关闭 Wireless debugging。[Android 15 实现][manager15]、[Android 16 广播处理][receiver16] |
| Android 16 `r4`，重连开关关闭 | `getCurrentWifiApInfo()` 与可信网络检查保留 | 独立的 `AdbBroadcastReceiver` 保留旧行为。[r4 开启处理][enable4]、[r4 广播处理][receiver4] |
| Android 16 `r4`，重连开关开启 | 同上；新监控只请求 Wi-Fi 网络 | `onLost()` 关闭，回到可信 BSSID 时自动开启；没有 Wi-Fi 时仍关闭。[网络回调实现][monitor4] |

当前 Android 官方 adb 页面还混入 Android 17／ADB Wi-Fi 2.0 的新说明。官方发布文章明确要求 Android 17 和 Platform-Tools 37.0.0；不能把这些宣传或当前文档中的自动重连承诺直接当作所有 Android 16 产品的行为。[Android 官方 ADB Wi-Fi 2.0 发布说明][wifi2]。

## 2. 是谁阻止无 Wi-Fi 开启，又是谁负责关闭

### Settings UI 的第一道检查

Android 16 `r1` 类名为 `WirelessDebuggingPreferenceController`；`r4` 改名为 `AdbWirelessDebuggingPreferenceController`。两版 `isWifiConnected()` 都遍历 `ConnectivityManager.getAllNetworks()`，寻找具有 `TRANSPORT_WIFI` 的网络；`onPreferenceChange()` 在用户尝试开启且未找到 Wi-Fi 时显示提示并返回 `false`。它检查的是网络能力，不是接口名是否为 `wlan0`；仅有蜂窝网络上的 Tailscale VPN 不会凭空产生所需的 Wi-Fi 连接。[r1 控制器][ui16]、[r4 控制器][ui4]。

### Framework 的第二道检查

`AdbService.AdbSettingsObserver.onChange()` 监听 `Settings.Global.ADB_WIFI_ENABLED`，即数据库键 `adb_wifi_enabled`；变化送往 `setAdbEnabled(..., AdbTransportType.WIFI)`。`r1` 的 `setAdbEnabled()` 相应写 `persist.adb.tls_server.enable`、启动或停止 adbd，再通知 `AdbDebuggingManager.setAdbEnabled()`。`r4` 同类入口改由 `setAdbEnabledDoNotCallDirectly()` 执行，并提取 `enableADBdWifi()`／`disableADBdWifi()`。[r1 设置观察及服务入口][service16]、[r4 服务入口][service4]。

`AdbDebuggingManager.AdbDebuggingHandler` 的 `MSG_ADBDWIFI_ENABLE` 才进一步核对 Wi-Fi：`getCurrentWifiApInfo()` 要求 `WifiManager.getConnectionInfo()` 非空、`networkId != -1`，能取得 SSID 和非空 BSSID。失败就把 `adb_wifi_enabled` 写回 0；成功后仍要经 `verifyWifiNetwork()` 确认可信 BSSID，否则发起网络许可提示并暂时写回 0。用户同意的 `MSG_ADBWIFI_ALLOW` 分支会再次核对当前 BSSID，避免同意的是已离开的网络。这些检查在 `r1` 和 `r4` 均存在。[r1 开启处理][enable16]、[r1 接入点与信任检查][ap16]、[r4 开启处理][enable4]、[r4 接入点检查][ap4]。

`r1` 的广播接收器在收到 Wi-Fi 禁用、Wi-Fi 网络未连接、无效 `WifiInfo`、空 BSSID 或 BSSID 与开启时不同的事件时，直接把 `adb_wifi_enabled` 写成 0。这里比较的是接入点 BSSID，不能理解为只有整个 SSID 名称变更才关闭。`r4` 开关关闭时的 `AdbBroadcastReceiver` 延续这一规则。[r1 `onReceive()`][receiver16]、[r4 `onReceive()`][receiver4]。

`r4` 重连开关开启时，`AdbWifiNetworkMonitor.register()` 注册 `ConnectivityManager.NetworkCallback`，请求 `TRANSPORT_WIFI` 和 `NET_CAPABILITY_INTERNET`；没有要求 `NET_CAPABILITY_VALIDATED`，因此不能将它解释成必须通过外网连通性验证。`onCapabilitiesChanged()` 检查 `WifiInfo`，`processWifiConnection()` 根据有效 BSSID 和可信列表写开／关，`onLost()` 清除上次 BSSID 并写 0。`unregister()` 刻意不解除回调，让它能在回到可信网络时自动开启。蜂窝网络和 VPN 不会替代这个 Wi-Fi 请求。[`AdbWifiNetworkMonitor`][monitor4]。

### 关闭的实际效果

设置回到 0 后，`AdbService` 把 `persist.adb.tls_server.enable` 置 0；adbd 的属性观察线程调用 `disable_wifi_debugging()`，删除 `TlsServer`、注销 TLS mDNS 服务并 `kick_all_tcp_tls_transports()`，同时清除／更新 TLS 端口属性。因此“`adb devices` 中 TLS transport 消失、TLS mDNS 广告消失、已有连接断开”都是有实现依据的结果，不只是 UI 关掉图标。`AdbService.stopAdbd()` 还会在 USB 和 Wi-Fi 两类调试均关闭时停止整个 daemon。[服务关闭入口][service16]、[TLS 删除及 transport 清理][tlsstop]。

`r4` 的源码也有基于 `useTlsLifecycle()`、API／预发布代号条件的 adbdauth 生命周期协议，以及旧属性方式；这属于控制通道变化，不是新增 Tailscale／蜂窝网络许可。`wifiLifeCycleOverAdbdauthSupported()`、`startAdbdWifi()`、`stopAdbdWifi()` 与 daemon 的可用性检查必须一起看，不能仅凭某个方法名断言所有 Android 16 都采用新协议。[框架生命周期条件][lifecycle4]、[r4 daemon 生命周期条件][tls4]。

## 3. TLS 到底绑定哪个地址，能否接收 tun 上的连接

**源码事实：没有绑定 Wi-Fi 的具体 IP，也没有按 Wi-Fi 接口名绑定。** `daemon/adb_wifi.cpp` 中 `TlsServer::Start()` 调用 `network_inaddr_any_server(port_, SOCK_STREAM, ...)`；`TlsServer(0)` 让系统分配端口。`sysdeps.h` 将该函数接到 libcutils 的 `socket_inaddr_any_server()`，后者创建 `AF_INET6` socket 并绑定 `in6addr_any`（`[::]` 通配地址），没有 `SO_BINDTODEVICE`。`r4` 仍使用同一通配监听调用。[r1 TLS Start][tls16]、[sysdeps 包装][sysdeps16]、[libcutils bind 实现][socketany]、[r4 TLS Start][tls4]。

**源码判断：只要服务器仍在运行，来源于 tun 的 TCP 连接没有被这个监听器按接口排除。** `TlsServer::OnFdEvent()` 直接 `accept()`，把连接交给 `register_socket_transport(..., true)`；TLS 认证在 `adbd_tls_verify_cert()` 等处检查已授权公钥，而不是要求对端地址属于 Wi-Fi 网段。由此推断，Tailscale 已将数据送入手机网络栈、策略允许且地址族可用时，可以对 `<手机的 Tailscale 地址>:<TLS 连接端口>` 手动 `adb connect`。本任务没有实测这条 TLS-over-Tailscale 路径；既有现场验证的是传统 TCP，不能冒充 TLS 验证。[TLS accept][tlsaccept]、[TLS 公钥验证][auth16]。

因此，tun 从 `tun0` 变成 `tun1` 不是 adbd 的绑定问题；原生 TLS 在 Wi-Fi 关闭时消失是生命周期问题。通配监听不等于承诺旧 TCP 会话跨底层网络切换不断线，网络恢复后仍可能需要重新 `adb connect`。[通配监听][socketany]、[Wi-Fi 关闭流程][receiver16]、[Tailscale 跨网络连接机制][tsconcept]。

配对端口和连接端口是两回事：`_adb-tls-pairing._tcp` 用于配对，`_adb-tls-connect._tcp` 用于日常 TLS 连接，传统 `_adb._tcp` 又是第三种服务；把配对窗口里的临时端口长期写死不可取。Tailscale 的常规网络不提供同一二层 LAN 的多播发现条件；其官方资料明确记载多播丢弃，故使用已知地址和当前连接端口，不能把“未发现 mDNS”单独当作 TCP 不可达。[ADB 服务类型说明][architecture]、[Tailscale 多播丢弃说明][tsmetrics]。

## 4. `settings put global adb_wifi_enabled 1` 能否绕过

**普通单次写入：不能获得稳定的无 Wi-Fi 模式。** 已有 `adb shell` 可以绕过 Settings UI 的第一道检查，写入值 1，但随后同样进入 `AdbService` 和 `MSG_ADBDWIFI_ENABLE`，没有有效接入点就被写回 0；未知 Wi-Fi 网络也仍需用户许可。已经没有任何 ADB／特权入口时，单纯提出这条命令并不能解决“从哪里获得 shell”这个引导问题。[设置观察入口][service16]、[框架拒绝分支][enable16]、[r4 同类拒绝分支][enable4]。

需要保留一个精确例外：`AdbService` 写使能属性先于 `AdbDebuggingManager` 完成 Wi-Fi 拒绝检查，所以某些版本可能短暂出现 TLS socket；不能把它描述成“一次写入绝对没有打开过”。上游实验工具确实试图反复写 `adb_wifi_enabled` 利用这段时序，详见第 6 节。这不改变单次写入会被正常检查关闭的结论，也没有提供可依赖的长期接口。[服务与 manager 调用顺序][service16]、[实验工具的实际实现][forcednext]。

直接 `setprop persist.adb.tls_server.enable 1` 不是未 root 手机 shell 的受支持替代方案：AOSP 将其标为 `system_adbd_prop`，SELinux 明确只准 init 和 system_server 设置。`WRITE_SECURE_SETTINGS` 允许写相应设置不等于获得设置系统属性的 SELinux 权限。[属性分类][propcontexts]、[`system_adbd_prop` 写入限制][proppolicy]。

## 5. 传统 `adb tcpip`：为什么适合蜂窝网络，哪些状态会保留

`adb tcpip <端口>` 是发给已经连通的 adbd 的服务请求。`daemon/services.cpp` 将 `tcpip:` 转给 `restart_tcp_service()`，后者只写 `service.adb.tcp.port`，没有写 `persist.adb.tcp.port`，也没有直接清除 `adb_wifi_enabled`。`adb usb` 的 `restart_usb_service()` 写 `service.adb.tcp.port=0`。引导请求不要求一定来自 USB，因此在 Wi-Fi 可用时，经已配对的 TLS ADB 同样可以请求开启传统 TCP。[服务分派][services16]、[`restart_tcp_service()` / `restart_usb_service()`][restart16]。

adbd 启动读取顺序是：先看 `service.adb.listen_addrs`；若未指定，再看 `service.adb.tcp.port`；仅在后者为空时才看 `persist.adb.tcp.port`。有效正端口会生成 `tcp:<端口>` 监听；设备端 `socket_spec_listen()` 对无主机名的 `tcp:` 使用通配地址。这里没有 Wi-Fi／BSSID 检查，所以传统 socket 能覆盖蜂窝网络上的 Tailscale tun 地址。[`adbd_main()`][main16]、[`socket_spec_listen()`][socketlisten]、[传统连接 accept 循环][transport16]。

| 事件／配置 | 传统 TCP 的结果与边界 |
| --- | --- |
| 拔掉 USB | 不会仅因拔线而清除 `service.adb.tcp.port`；官方流程本来就要求设端口后拔线。本机既有现场记录也已验证。[官方传统 TCP 步骤][androidadb] |
| 关闭 Wi-Fi／切换 Wi-Fi 与蜂窝网络 | 监听不依赖 Wi-Fi，属性不会由该网络广播逻辑清除；Tailscale 恢复后可重连。已有会话是否连续不作保证。[传统监听][transport16]、[Wi-Fi 广播仅改 TLS 设置][receiver16] |
| adbd 进程在同次开机内重启 | 只要端口属性未被改写，启动会再次读取；进程被停止时端口当然暂时不存在。不要把“属性还有值”当作“端口正在监听”。[启动读取][main16]、[服务停止条件][service16] |
| 手机完整重启 | `service.*` 是运行时属性；这条命令没有生成持久设置，因此不能依赖它跨重启保留。`persist.*` 才有持久文件写入／开机加载机制。[命令写入对象][restart16]、[init 属性保存与加载][propertyservice] |
| 关闭 USB debugging／Developer options | 不能保证 TCP 继续可用：Wi-Fi 调试也关闭时，`AdbService.stopAdbd()` 会停止 daemon。保持“USB debugging 设置开着”与“USB 线一直插着”是不同要求。[停止条件][service16]、[开发者总开关关闭时关闭 Wi-Fi 调试][ui16] |
| `adb usb`／其他调用改写 TCP 属性 | 原传统端口配置被覆盖；不要把它用于需要保留远端 TCP 入口的会话。[USB 服务实现][restart16] |
| `persist.adb.tcp.port` 已由有权限的系统配置 | 理论上能跨重启提供端口默认值，但仍取决于 adbd 被启动、`service` 属性未覆盖等条件；普通未 root shell 没有通用设置权限，不作为本任务推荐方案。[启动优先级][main16]、[AOSP 属性标签及默认标签][propcontexts]、[默认属性写入限制][proppolicy] |

AOSP `property_contexts` 没有为 `persist.adb.tcp.port` 提供这类普通 shell 授权；未匹配属性落到 `default_prop`，其写入只允许 init。`service.adb.tcp.port` 则有专用 `adbd_config_prop`，其允许写入的域包含 adbd、system_server 等，明确不包括 shell。因此，在本机 shell 中运行 `setprop service.adb.tcp.port ...` 也不能替代给 daemon 发送 `adb tcpip` 请求；Shizuku 获得 shell 身份同样不自动越过这道限制。OEM 可以另有策略，本机未测。[AOSP 属性映射][propcontexts]、[两类属性写入限制][proppolicy]。

传统 TCP 与 TLS 是两个 socket／协议入口。传统 TCP 自身不加密，仍有标准 adbd 公钥授权；通过 Tailscale 传输时由 WireGuard 隧道保护这一路流量，但通配传统端口也可能被其他可达接口访问，不能描述成“端口只向 tailnet 开放”。这一差异是选用传统方案的实际代价。[ADB 官方架构文档][architecture]、[默认认证及密钥验证][auth16]、[Tailscale 加密机制][tsconcept]。

## 6. 无 root 备选方案与每次操作

| 方案 | 判断 | 手机每次要做什么 | 什么会打断／限制它 |
| --- | --- | --- | --- |
| Wi-Fi 关闭，直接开启原生 TLS Wireless debugging，通过 Tailscale 用 | **不支持正常稳定使用** | UI 不允许；单次写设置会被框架撤销 | Wi-Fi 门槛与关闭逻辑。[UI][ui4]、[开启检查][enable4] |
| Wi-Fi 保持连接，TLS 经 Tailscale 接入 | **源码支持，当前手机未验证** | 首次配对、允许网络；旧分支断开后重新开启；读取当前 TLS 连接端口 | Wi-Fi 断连／BSSID 改变、调试关闭、认证失效；随机端口变化。[TLS][tls4]、[旧监控][receiver4]、[新监控][monitor4] |
| USB 引导传统 TCP，再关 Wi-Fi、拔 USB | **本机既有记录已验证** | 每次重启后有一次可用的 ADB 引导；确认主机授权，保持 USB debugging 设置开启 | 重启清除运行时配置；停掉 adbd、改端口、Tailscale 不通。[传统服务][restart16]、[生命周期][service16] |
| 临时连 Wi-Fi，用 TLS 或手机本机 ADB 引导传统 TCP，然后关 Wi-Fi | **协议／源码支持，完整本机流程未验证** | 重启后暂时连 Wi-Fi、开启 Wireless debugging、连接已配对客户端，执行一次 `adb tcpip`；新客户端需配对 | 无法先建立 TLS 就无法引导；随后仍受传统 TCP 的重启边界限制。[服务分派][services16]、[本机 ADB 客户端例子][shizukuclient] |
| 只开启这台手机自己的个人热点，视作已连接 Wi-Fi | **AOSP 常规路径不成立；OEM 例外未验证** | 单独开热点不是连接接入点；如果同时连接另一 Wi-Fi，则满足条件的是后者 | `getConnectionInfo()`／networkId／BSSID 检查；新监控还明确排除热点类网络。[接入点检查][ap16]、[热点过滤注释及请求][monitor4] |
| 官方 Shizuku | **可无电脑引导 shell 服务；不能单凭安装获得 Mac 远端 adbd** | Android 11+ 开启 Wireless debugging、一次配对，再点启动；官方手册要求重启后重新启动 | 首次／重新引导仍依赖系统 TLS；服务存活不证明 TLS 监听存活；进程和 OEM 策略另有影响。[官方手册][shizukumanual]、[启动执行][shizukustart] |
| LADB／同类本机 ADB 客户端 | **可操作已有本机 TLS；不能移除框架 Wi-Fi 门槛** | 初次在分屏／浮窗中输入配对信息，后续需可连接的 adbd；重启后重新建立入口 | Wireless debugging 无法开启／服务器被关闭时同样无法连接。[LADB 上游说明][ladb] |
| 手机本机 adb 客户端发送 `tcpip:` | **适合无 USB 但暂有 Wi-Fi的引导；本机未验证** | 客户端已配对并可连接时发送请求；不要把 `adb tcpip` 当普通 shell 内建命令 | 只有 shell 的工具必须另外实现 ADB 服务请求或启动 adb 客户端；直接 `setprop` 受 SELinux 限制。[服务分派][services16]、[属性限制][proppolicy] |
| Shizuku-Next 的实验性无 Wi-Fi 启动＋TCP 模式 | **上游有实现，本机未验证，不作稳定方案承诺** | 预先满足配对、写设置等权限，解锁后尝试实验开关，可能临时建立本地热点 | 框架检查时序、权限、热点／mDNS、Android 版本与 OEM 实现；重启后仍需成功引导。[实验实现][forcednext]、[转传统端口实现][nexttcp] |

Shizuku 的功能应分两层看：它通过 ADB 执行启动命令，随后提供一个供应用调用系统 API 的进程；该进程不是供 Mac `adb connect` 的 adbd TLS／TCP 监听器。某些手机离开 Wi-Fi 后 Shizuku 进程仍能工作，不代表 Wireless debugging 仍开启。当前官方上游还有 `BootCompleteReceiver`：Android 13+、预先授予 `WRITE_SECURE_SETTINGS`、此前为 ADB 启动等条件成立时，写设置后用 localhost ADB 尝试启动；这条路径仍没有撤掉平台 Wi-Fi 检查，不能据此承诺纯蜂窝冷启动。[Shizuku 启动源码][shizukustart]、[开机接收器][shizukuboot]。

另一个值得保留但不能混同正式支持的发现是 Shizuku-Next。核对的上游提交为 `d4be2449344d11609b1667eecc8f3d1744a0d2bc`：`ForcedWirelessDebugging.nudge()` 建立 local-only hotspot、反复尝试写设置；`AdbStarter.openTcpPort()` 可通过临时 TLS 连接发 `tcpip:<port>` 并检查本地传统端口。这说明“重启后无 USB、无外部 Wi-Fi”的实验性引导代码确实存在；它利用时序与临时热点，不是让 Tailscale tun 获得 Wi-Fi 身份，也不是 Wi-Fi 无线电始终关闭。本次只确认实现，未安装、未验证成功率与具体 Android 16 OEM 适配。[`ForcedWirelessDebugging`][forcednext]、[`openTcpPort()`][nexttcp]。

## 7. Tailscale 官方资料能确认什么

Tailscale 官方说明它通过 WireGuard 连接不同网络上的设备；Android 安装流程创建 VPN 配置。它提供的是 IP 连通性，不会替 Android 修改 Wi-Fi 信任列表或启动 adbd。本次检索官方文档未找到“可让 Android 16 在 Wi-Fi 关闭时保持原生 Wireless debugging”的官方承诺。[Tailscale 原理][tsconcept]、[Android 安装说明][tsandroid]。

“同一个 tailnet”也不是充分条件：手机 Tailscale 必须在线，访问控制必须允许 Mac 到目标端口，客户端不能处于阻止入站连接的 shields-up 状态。Tailscale 官方说明允许入站连接仍受访问策略限制。无需因为使用 Tailscale 而保留固定 tun 名称；应以设备的 tailnet 地址／名称和实际端口为连接目标。[Tailscale 入站偏好说明][tsprefs]、[通配监听实现][socketany]。

## 8. 对既有现场结果的解释与尚未验证项

任务提供的现场观察是：Wi-Fi 关闭、USB 拔除，传统 TCP 经 Tailscale 成功；原生 `adb_wifi_enabled` 后来由 1 变 0，TLS transport 和 mDNS 服务消失；恢复 Wireless debugging 后旧配对仍可使用；持久 TCP 属性始终为空。这与“传统 TCP 独立监听＋TLS 生命周期受 Wi-Fi 控制＋授权密钥独立保存”的实现一致；这段是既有记录的解释，不是本研究新增实测。[传统端口读取][main16]、[TLS 清理][tlsstop]、[ADB 配对密钥机制][architecture]。

**能够判定的因果关系：关闭 Wi-Fi 本身已经足以触发原生 TLS 关闭。** `restart_tcp_service()` 没有直接写 `adb_wifi_enabled=0`；旧版 manager 又存在 TLS 服务器断开／端口轮询失败时把设置写回 0 的分支，因此没有当轮时序日志就不能确定 `adb tcpip` 引发的 daemon 重启是否也参与了该次关闭。报告不把“一起发生”改写成“已证明只有一个原因”。[Wi-Fi 关闭分支][receiver16]、[tcpip 实现][restart16]、[服务器断开处理][serverdisconnect]。

仍未验证的内容包括：具体手机采用哪个 Android 16 标签／OEM 改动及重连开关；Wi-Fi 保持连接时 TLS 经 Tailscale 的直接连接；手机临时 Wi-Fi 上本机客户端转传统 TCP 的完整流程；自身热点的 OEM 行为；实验性无网络引导在该机的成功率。没有证据支持“未 root、无 USB、Wi-Fi 一直关闭且每次重启都自动恢复远端 adb”的通用保证。下一步若单独获得设备试验授权，应逐项验证这些缺口；本报告没有执行试验。

[ui16]: https://android.googlesource.com/platform/packages/apps/Settings/+/refs/tags/android-16.0.0_r1/src/com/android/settings/development/WirelessDebuggingPreferenceController.java#142
[ui4]: https://android.googlesource.com/platform/packages/apps/Settings/+/refs/tags/android-16.0.0_r4/src/com/android/settings/development/AdbWirelessDebuggingPreferenceController.java#142
[enable16]: https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-16.0.0_r1/services/core/java/com/android/server/adb/AdbDebuggingManager.java#1049
[receiver16]: https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-16.0.0_r1/services/core/java/com/android/server/adb/AdbDebuggingManager.java#641
[ap16]: https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-16.0.0_r1/services/core/java/com/android/server/adb/AdbDebuggingManager.java#1362
[serverdisconnect]: https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-16.0.0_r1/services/core/java/com/android/server/adb/AdbDebuggingManager.java#1222
[service16]: https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-16.0.0_r1/services/core/java/com/android/server/adb/AdbService.java
[service4]: https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-16.0.0_r4/services/core/java/com/android/server/adb/AdbService.java#421
[manager2]: https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-16.0.0_r2/services/core/java/com/android/server/adb/AdbDebuggingManager.java#641
[manager3]: https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-16.0.0_r3/services/core/java/com/android/server/adb/AdbDebuggingManager.java#641
[manager11]: https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-11.0.0_r1/services/core/java/com/android/server/adb/AdbDebuggingManager.java#596
[manager15]: https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-15.0.0_r1/services/core/java/com/android/server/adb/AdbDebuggingManager.java#656
[monitorchoice]: https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-16.0.0_r4/services/core/java/com/android/server/adb/AdbDebuggingManager.java#603
[flags16]: https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-16.0.0_r4/services/core/java/com/android/server/adb/adb_flags.aconfig
[enable4]: https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-16.0.0_r4/services/core/java/com/android/server/adb/AdbDebuggingManager.java#810
[ap4]: https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-16.0.0_r4/services/core/java/com/android/server/adb/AdbDebuggingManager.java#1090
[receiver4]: https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-16.0.0_r4/services/core/java/com/android/server/adb/AdbBroadcastReceiver.java
[monitor4]: https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-16.0.0_r4/services/core/java/com/android/server/adb/AdbWifiNetworkMonitor.java
[lifecycle4]: https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-16.0.0_r4/services/core/java/com/android/server/adb/AdbDebuggingManager.java#456
[tls16]: https://android.googlesource.com/platform/packages/modules/adb/+/refs/tags/android-16.0.0_r1/daemon/adb_wifi.cpp#75
[tls4]: https://android.googlesource.com/platform/packages/modules/adb/+/refs/tags/android-16.0.0_r4/daemon/adb_wifi.cpp
[tlsaccept]: https://android.googlesource.com/platform/packages/modules/adb/+/refs/tags/android-16.0.0_r1/daemon/adb_wifi.cpp#130
[tlsstop]: https://android.googlesource.com/platform/packages/modules/adb/+/refs/tags/android-16.0.0_r1/daemon/adb_wifi.cpp#173
[sysdeps16]: https://android.googlesource.com/platform/packages/modules/adb/+/refs/tags/android-16.0.0_r1/sysdeps.h#604
[socketany]: https://android.googlesource.com/platform/system/core/+/refs/tags/android-16.0.0_r1/libcutils/socket_inaddr_any_server_unix.cpp#34
[auth16]: https://android.googlesource.com/platform/packages/modules/adb/+/refs/tags/android-16.0.0_r1/daemon/auth.cpp
[restart16]: https://android.googlesource.com/platform/packages/modules/adb/+/refs/tags/android-16.0.0_r1/daemon/restart_service.cpp#57
[main16]: https://android.googlesource.com/platform/packages/modules/adb/+/refs/tags/android-16.0.0_r1/daemon/main.cpp#269
[services16]: https://android.googlesource.com/platform/packages/modules/adb/+/refs/tags/android-16.0.0_r1/daemon/services.cpp#315
[socketlisten]: https://android.googlesource.com/platform/packages/modules/adb/+/refs/tags/android-16.0.0_r1/socket_spec.cpp#339
[transport16]: https://android.googlesource.com/platform/packages/modules/adb/+/refs/tags/android-16.0.0_r1/daemon/transport_socket_server.cpp#43
[architecture]: https://android.googlesource.com/platform/packages/modules/adb/+/refs/tags/android-16.0.0_r1/docs/dev/adb_wifi.md
[propcontexts]: https://android.googlesource.com/platform/system/sepolicy/+/refs/tags/android-16.0.0_r1/private/property_contexts#52
[proppolicy]: https://android.googlesource.com/platform/system/sepolicy/+/refs/tags/android-16.0.0_r1/private/property.te#522
[propertyservice]: https://android.googlesource.com/platform/system/core/+/refs/tags/android-16.0.0_r1/init/property_service.cpp#421
[androidadb]: https://developer.android.com/tools/adb#wireless
[wifi2]: https://developer.android.com/blog/posts/introducing-fast-and-reliable-wireless-debugging-with-android-debug-bridge-adb-wi-fi-2-0
[tsconcept]: https://tailscale.com/docs/concepts/what-is-tailscale
[tsandroid]: https://tailscale.com/docs/install/android
[tsprefs]: https://tailscale.com/docs/features/client/manage-preferences#allow-incoming-connections
[tsmetrics]: https://tailscale.com/docs/reference/tailscale-client-metrics#dropped-packets
[shizukumanual]: https://shizuku.rikka.app/guide/setup/
[shizukuclient]: https://github.com/RikkaApps/Shizuku/blob/b844bc491f1790c72328e1a8e5b2349f8978f0ea/manager/src/main/java/moe/shizuku/manager/adb/AdbClient.kt#L44
[shizukustart]: https://github.com/RikkaApps/Shizuku/blob/b844bc491f1790c72328e1a8e5b2349f8978f0ea/manager/src/main/java/moe/shizuku/manager/starter/StarterActivity.kt#L181
[shizukuboot]: https://github.com/RikkaApps/Shizuku/blob/b844bc491f1790c72328e1a8e5b2349f8978f0ea/manager/src/main/java/moe/shizuku/manager/receiver/BootCompleteReceiver.kt
[ladb]: https://github.com/tytydraco/LADB/blob/60f48029cf9d8e0bc848ca41a7bd76694d4ab796/README.md
[forcednext]: https://github.com/rushiranpise/Shizuku-Next/blob/d4be2449344d11609b1667eecc8f3d1744a0d2bc/manager/src/main/java/moe/shizuku/manager/start/ForcedWirelessDebugging.kt
[nexttcp]: https://github.com/rushiranpise/Shizuku-Next/blob/d4be2449344d11609b1667eecc8f3d1744a0d2bc/manager/src/main/java/moe/shizuku/manager/adb/AdbStarter.kt#L390
