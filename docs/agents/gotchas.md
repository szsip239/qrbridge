# DSH 扫码卡开发踩坑

- 独立的 3095 测试实例使用同一个 `DeepSeek Harness` 可执行文件，`dsh-deploy` 会把它当成仍在运行的日常桌面，导致部署中止。日常桌面部署前先关闭测试实例。
- ego-lite 打开本机回环地址的 DSH 页面可能报 `ERR_HTTP_RESPONSE_CODE_FAILURE`。可用 `curl` 请求本机的 `/mosaic/native-surfaces` 打开 Widget Window，使用当前测试实例的 `dsh-auth` cookie、与该实例一致的 `Origin` 和 `Sec-Fetch-Site: same-origin` 请求头。
- 折叠与玻璃动画用 60 fps 录制实际 Widget Window 验证。WebKit 会立即应用长度为零的延迟过渡，并丢弃注册属性关键帧中的 `var()`，Chromium 预览无法复现这些行为。
- Board 上的卡片固定在加入时的 widget 版本。部署插件后核对现有卡片的版本，必要时走库的升级方案。
- `SCStream` 弱引用其输出对象。采集运行期间保留对 `Feed` 的强引用。
- 微信进入扫码页时还在做切入动画。移除 `open` 固定等待后，点击在切入期间落下，16 次尝试全部失败。保留已验证的等待。
