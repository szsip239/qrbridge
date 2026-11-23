# 安卓扫码桥接

把电脑上的二维码经虚拟摄像头送进安卓手机里的原版 App，在虚拟屏幕上完成扫码登录。入口、命令与运行方式见 `README.md`，真机结果与边界见 `RESULTS.md`，各 App 的场景与验收关卡见 `scenarios/`。

排查 DSH 扫码卡的预览、窗口与采集问题时，见 [扫码卡开发踩坑](docs/agents/gotchas.md)。

## 工作约定

- 手机操作交给 GPT-6.1 Terra / high / fast Worker；主会话负责协调与汇总。
- 以系统活动转储、`media.camera` 的虚拟相机连接、同轮 `capture-frame` 与业务端结果验收；扫码预览的空控件树不是失败判据。
- 遇到人脸、密码、短信验证码、付款页或风险提示即停下报告。不 root、不改系统与安全设置。
- 产物、签名密钥、截图、原始日志和设备资料放在 Git 忽略的 `.local/`；仓库是公开的，文件里不写账号、序列号、IP 或配对码。

## Agent skills

### Issue tracker

Issues live in GitHub Issues of `szsip239/qrbridge`, managed with `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

The default five triage roles, label strings equal to their names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` and `docs/adr/`, created lazily. See `docs/agents/domain.md`.
