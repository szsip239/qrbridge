#!/usr/bin/env python3
"""二维码虚拟摄像头原型命令行。"""
import argparse
import base64
import json
import re
import shlex
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LOCAL = ROOT / '.local'
REMOTE = '/data/local/tmp/android-qr-bridge'
# 专属的本地管理地址，不对应真实蓝牙设备。
ASSOCIATION_MAC = '02:00:00:51:52:42'
WECHAT = 'com.tencent.mm'
ALIPAY = 'com.eg.android.AlipayGphone'
WECHAT_MAIN = f'{WECHAT}/{WECHAT}.ui.LauncherUI'
SCANNERS = {
    WECHAT: f'{WECHAT}/{WECHAT}.plugin.scanner.ui.BaseScanUI',
    ALIPAY: f'{ALIPAY}/com.alipay.mobile.scan.as.main.MainCaptureActivity',
}
DOUBLE_APP = 'com.vivo.doubleinstance/com.vivo.doubleinstance.DoubleAppResolverActivity'


def top_activity(dump, display):
    current_display = None
    for line in dump.splitlines():
        header = re.match(r'Display #(\d+) \(activities from top to bottom\):', line)
        if header:
            current_display = int(header[1])
        if current_display == display:
            resumed = re.search(r'topResumedActivity=ActivityRecord\{\S+ u\d+ (\S+)', line)
            if resumed:
                package, activity = resumed[1].split('/')
                return f'{package}/{package + activity if activity.startswith(".") else activity}'
    return None


def bounds_centre(bounds):
    left, top, right, bottom = bounds
    return round((left + right) / 2), round((top + bottom) / 2)


def wechat_plus_position(width, density):
    # Measured on the phone's own 1080x2400@480 metrics: WeChat's + sits 25 dp from the right edge, 22 dp from the top.
    scale = density / 160
    return round(width - 25 * scale), round(22 * scale)


def scan_menu_position(observations):
    # OCR may read the menu icon beside the label as punctuation, e.g. "）Scan".
    matches = [item for item in observations
               if re.sub(r'\W', '', item['text']).casefold() in ('扫一扫', '掃一掃', 'scan')]
    if len(matches) != 1:
        raise RuntimeError('微信菜单未找到唯一的扫一扫／Scan')
    return bounds_centre(matches[0]['bounds'])


def original_app_position(tree):
    pending = list(tree['windows'])
    while pending:
        node = pending.pop()
        if node['id'] == 'com.vivo.doubleinstance:id/main':
            return bounds_centre([int(value) for value in node['bounds'].split()])
        pending.extend(node['children'])
    raise RuntimeError('vivo 选择框未找到原版应用')


def build_ocr():
    source = ROOT / 'native/scan-ocr.swift'
    binary = LOCAL / 'build/scan-ocr'
    if not binary.exists() or binary.stat().st_mtime < source.stat().st_mtime:
        binary.parent.mkdir(parents=True, exist_ok=True)
        done = subprocess.run(['swiftc', '-O', str(source), '-o', str(binary)], capture_output=True, text=True)
        if done.returncode:
            raise RuntimeError('OCR 构建失败：' + done.stderr.strip().splitlines()[-1])
    return binary


def recognize_screen(binary, png):
    with tempfile.TemporaryDirectory(prefix='open-', dir=LOCAL) as directory:
        path = Path(directory) / 'screen.png'
        path.write_bytes(png)
        done = subprocess.run([str(binary), str(path)], capture_output=True, text=True)
    if done.returncode:
        raise RuntimeError(done.stderr.strip().splitlines()[-1])
    return json.loads(done.stdout)

class Bridge:
    def __init__(self, serial):
        self.adb = ['adb'] + (['-s', serial] if serial else [])
        if serial and ':' in serial:
            # A network device drops off adb after the Mac's adb server restarts; a failed connect shows up as "not found" next.
            subprocess.run(['adb', 'connect', serial], capture_output=True, timeout=10)

    def run(self, *args):
        done = subprocess.run(self.adb + list(args), capture_output=True)
        if done.returncode:
            # adb's own last stderr line (for example "device ... not found") tells the card what went wrong.
            lines = done.stderr.decode().strip().splitlines()
            raise RuntimeError(lines[-1] if lines else f'adb {args[0]} 退出码 {done.returncode}')
        return done.stdout.decode().strip()

    def shell(self, *args):
        return self.run('shell', shlex.join(args))

    def request(self, command, **values):
        port = int(self.run('forward', 'tcp:0', 'localabstract:android_qr_bridge'))
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=20) as connection:
                connection.sendall((json.dumps(dict(command=command, **values)) + '\n').encode())
                line = connection.makefile('rb').readline()
            if not line:
                raise RuntimeError('主机未运行或已断开：桥接端口没有回应')
            result = json.loads(line)
            if 'error' in result:
                raise RuntimeError(result['error'])
            return result
        finally:
            self.run('forward', '--remove', f'tcp:{port}')

    def association(self):
        text = self.shell('cmd', 'companiondevice', 'list', '0')
        matches = [line.split('|')[0].strip() for line in text.splitlines()
                   if 'com.android.shell' in line and ASSOCIATION_MAC.lower() in line.lower()]
        return matches[0] if matches else None

    def start(self, display_mode, screen=None):
        if self.association():
            raise RuntimeError('原型 association 已存在；先查看日志并运行 stop 清理，避免重复启动')
        self.shell('mkdir', '-p', REMOTE)
        self.run('push', str(LOCAL / 'build/bridge.jar'), f'{REMOTE}/bridge.jar')
        self.shell('cmd', 'companiondevice', 'associate', '0', 'com.android.shell',
                   ASSOCIATION_MAC, 'android.app.role.COMPANION_DEVICE_APP_STREAMING', 'true')
        association = self.association()
        if not association:
            raise RuntimeError('association 创建未完成，查看 dumpsys companiondevice')
        command = (f'CLASSPATH={REMOTE}/bridge.jar nohup app_process / local.qrbridge.BridgeHost '
                   f'{association} {display_mode} {screen or ""} >{REMOTE}/host.log 2>&1 </dev/null & echo $! >{REMOTE}/host.pid; cat {REMOTE}/host.pid')
        return {'started_pid': self.run('shell', command), 'remote_log': f'{REMOTE}/host.log'}

    def stop(self):
        # The host may already be gone (phone rebooted, stopped elsewhere); stopping still clears the association.
        pid = self.run('shell', f'cat {REMOTE}/host.pid 2>/dev/null; true')
        running = subprocess.run(self.adb + ['shell', f'kill -0 {shlex.quote(pid)}'], capture_output=True).returncode == 0
        if running:
            self.request('stop')
        association = self.association()
        if association:
            self.shell('cmd', 'companiondevice', 'disassociate', '0', 'com.android.shell', ASSOCIATION_MAC)
        return {'stop_requested': running, 'association_removed': bool(association)}

    def wait_ready(self, timeout=30):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            log = self.shell('cat', f'{REMOTE}/host.log')
            if 'READY' in log:
                return
            time.sleep(0.5)
        raise RuntimeError(f'主机 {timeout} 秒内未就绪，原始日志：\n{log}')

    def launcher(self, package):
        output = self.shell('cmd', 'package', 'resolve-activity', '--brief',
                            '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', package)
        return output.splitlines()[-1]

    def up(self, package, display_mode):
        started = self.start(display_mode)
        self.wait_ready()
        status = self.request('status')
        camera = self.request('grant-camera', package=package)
        launch = self.shell('am', 'start', '-W', '--display', str(status['display_id']), '-n', self.launcher(package))
        return {**started, 'status': status, 'camera': camera, 'launch': launch}

    def wait_activity(self, display, accepts, reason, timeout=15):
        deadline = time.monotonic() + timeout
        activity = None
        while time.monotonic() < deadline:
            activity = top_activity(self.shell('dumpsys', 'activity', 'activities'), display)
            if accepts(activity):
                return activity
            time.sleep(0.25)
        raise RuntimeError(f'{reason}（当前：{activity or "无活动"}）')

    def scan_menu(self, display, status, ocr):
        # round16: on a cold start WeChat drops or rejects the + tap while its main screen is still loading.
        for _ in range(4):
            time.sleep(0.8)
            try:
                self.tap(display, wechat_plus_position(status['width'], status['density']))
                time.sleep(0.6)
                # The menu hangs from the top bar; reading only the top of the screen halves the PNG and OCR time.
                return scan_menu_position(recognize_screen(ocr, self.screenshot(height=status['height'] * 2 // 5))['observations'])
            except RuntimeError:
                pass
        raise RuntimeError('微信菜单没有打开')

    def choose_original(self, display):
        # round16: a tap while the chooser sheet is still sliding in is dropped or rejected, so tap again until it closes.
        for _ in range(4):
            time.sleep(0.6)
            try:
                self.tap(display, original_app_position(self.request('tree')))
                return self.wait_activity(display, lambda top: top != DOUBLE_APP, '分身选择框没有关闭', timeout=2)
            except RuntimeError:
                pass
        raise RuntimeError('没能自动选择原版微信')

    def tap(self, display, position):
        self.request('tap', x=position[0], y=position[1])

    def screenshot(self, **crop):
        return base64.b64decode(self.request('screenshot', **crop)['data'])

    def open(self, package, scan=False):
        if scan and package not in SCANNERS:
            raise RuntimeError('直达扫一扫仅支持微信和支付宝')
        ocr = build_ocr() if scan and package == WECHAT else None
        running = self.run('shell', f'if [ -f {REMOTE}/host.pid ] && '
                           f'kill -0 "$(cat {REMOTE}/host.pid)" 2>/dev/null; then echo running; fi')
        started = running != 'running'
        if started:
            self.start('isolated')
            self.wait_ready()
        status = self.request('status')
        display = status['display_id']
        self.request('grant-camera', package=package)
        if scan and package == ALIPAY:
            self.shell('am', 'start', '-W', '--display', str(display), '-a', 'android.intent.action.VIEW',
                       '-d', 'alipays://platformapi/startapp?saId=10000007', '-p', package)
        else:
            component = f'{WECHAT}/.ui.LauncherUI' if package == WECHAT else self.launcher(package)
            self.shell('am', 'start', '-W', '--display', str(display), '-n', component)
            activity = self.wait_activity(display,
                                          lambda top: top == DOUBLE_APP or bool(top and top.startswith(package + '/')),
                                          '应用未在虚拟屏幕打开')
            if package == WECHAT and activity == DOUBLE_APP:
                activity = self.choose_original(display)
            # Opening WeChat again brings back its task as it was, which may already be the scanner.
            if scan and activity != SCANNERS[WECHAT]:
                top = self.wait_activity(display, lambda top: top in (WECHAT_MAIN, SCANNERS[WECHAT]), '微信未进入主界面')
                if top == WECHAT_MAIN:
                    self.tap(display, self.scan_menu(display, status, ocr))
        if scan:
            activity = self.wait_activity(display, lambda top: top == SCANNERS[package], '未进入扫一扫')
        else:
            activity = self.wait_activity(display, lambda top: bool(top and top.startswith(package + '/')),
                                          '应用未在虚拟屏幕打开')
        return {'started': started, 'opened': activity, 'scanning': scan}

    def down(self, log_path):
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text(self.run('shell', f'cat {REMOTE}/host.log 2>/dev/null; true') + '\n')
        result = self.stop()
        self.shell('rm', '-rf', REMOTE)
        return {**result, 'log_path': str(log_path)}

    def cameras(self):
        device = str(self.request('status')['device_id'])
        self.run('push', str(LOCAL / 'build/bridge.jar'), f'{REMOTE}/inventory.jar')
        output = self.run('shell', f'CLASSPATH={REMOTE}/inventory.jar app_process / local.qrbridge.CameraInventory {device}')
        return json.loads(output)

def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--serial', help='adb 设备序列号，或无线 host:port（自动 adb connect）；省略时由 adb 按 ANDROID_SERIAL 或唯一设备选择')
    commands = parser.add_subparsers(dest='command', required=True)
    for name, help_text in [('build','构建主机程序'),('build-probe','构建测试探针及已知二维码'),
                            ('install-probe','安装测试探针并授予其默认设备相机权限'),
                            ('stop','停止主机程序并移除本原型的 association'),('status','查看虚拟设备与相机状态'),
                            ('log','读取主机程序原始日志'),('cameras','对照默认设备与虚拟设备可见的相机 ID')]:
        commands.add_parser(name, help=help_text)
    start = commands.add_parser('start',help='推送并后台启动主机程序')
    start.add_argument('--display-mode',choices=('legacy','trusted','isolated'),default='isolated',
                       help='isolated 为受信任独立显示组；legacy 与 trusted 用于对照诊断')
    start.add_argument('--screen', help='虚拟屏幕 宽x高@dpi，默认与手机实体屏相同的 1080x2400@480')
    up = commands.add_parser('up', help='启动主机、等待就绪、为目标包授予虚拟设备 CAMERA 并在虚拟屏幕启动它')
    up.add_argument('package')
    up.add_argument('--display-mode',choices=('legacy','trusted','isolated'),default='isolated')
    open_app = commands.add_parser('open', help='复用或启动主机，在虚拟屏幕打开 App，可直达微信／支付宝扫一扫')
    open_app.add_argument('package')
    open_app.add_argument('--scan', action='store_true')
    commands.add_parser('down', help='保存主机日志后停止主机并删除手机端临时目录').add_argument('log_path', type=Path)
    commands.add_parser('image', help='送入 PNG 或 JPEG 图片').add_argument('path', type=Path)
    commands.add_parser('screenshot', help='保存虚拟屏幕 PNG').add_argument('path', type=Path)
    commands.add_parser('capture-frame', help='一次性保存实际交付的相机帧及时间戳元数据').add_argument('directory', type=Path)
    commands.add_parser('tree', help='保存同一虚拟屏幕的控件树 JSON').add_argument('path', type=Path)
    commands.add_parser('launch', help='在虚拟屏幕启动指定组件；不自动结束原任务').add_argument('component')
    tap = commands.add_parser('tap', help='点击虚拟屏幕坐标')
    tap.add_argument('x', type=int)
    tap.add_argument('y', type=int)
    commands.add_parser('text', help='经当前虚拟设备剪贴板粘贴 Unicode 文字').add_argument('text')
    commands.add_parser('key', help='向虚拟屏幕发送 Android 按键名或编号').add_argument('key')
    commands.add_parser('clipboard', help='读取当前虚拟设备的文字剪贴板')
    hold = commands.add_parser('long-press', help='长按虚拟屏幕坐标')
    hold.add_argument('x', type=int)
    hold.add_argument('y', type=int)
    hold.add_argument('--duration', type=int, default=600)
    swipe = commands.add_parser('swipe', help='在虚拟屏幕拖动')
    for name in ('x', 'y', 'end_x', 'end_y'):
        swipe.add_argument(name, type=int)
    swipe.add_argument('--duration', type=int, default=300)
    scroll = commands.add_parser('scroll', help='在虚拟屏幕滚动，正数向下／右')
    for name in ('x', 'y', 'delta_x', 'delta_y'):
        scroll.add_argument(name, type=float)
    commands.add_parser('camera-permission', help='查询指定包在当前虚拟设备上的 CAMERA 权限').add_argument('package')
    commands.add_parser('grant-camera', help='为指定包授予当前虚拟设备上的 CAMERA 权限').add_argument('package')
    return parser.parse_args()

def save_capture(bridge, args):
    if args.command == 'capture-frame':
        return save_delivered_frame(bridge,args.directory)
    result = bridge.request(args.command)
    args.path.parent.mkdir(parents=True,exist_ok=True)
    if args.command == 'screenshot':
        args.path.write_bytes(base64.b64decode(result.pop('data')))
    else:
        args.path.write_text(json.dumps(result,ensure_ascii=False,indent=2) + '\n')
    return {'path':str(args.path),'display_id':result['display_id']}

def run_display_command(bridge, args):
    display = str(bridge.request('status')['display_id'])
    output = bridge.shell('am','start','-W','--display',display,'-n',args.component)
    return {'display_id':int(display),'output':output}

def run_input_command(bridge, args):
    values = vars(args).copy()
    command = values.pop('command')
    values.pop('serial')
    return bridge.request(command, **values)

def save_delivered_frame(bridge, directory):
    result = bridge.request('capture-frame')
    directory.mkdir(parents=True,exist_ok=True)
    name = f'delivered-{result["timestamp_ms"]}-s{result["stream_id"]}-f{result["frame_id"]}'
    path = directory / f'{name}.png'
    path.write_bytes(base64.b64decode(result.pop('data')))
    result['path'] = str(path)
    result['metadata_path'] = str(directory / f'{name}.json')
    Path(result['metadata_path']).write_text(json.dumps(result,ensure_ascii=False,indent=2) + '\n')
    return result

def print_plain(bridge, command):
    if command in ('build','build-probe'):
        script = 'build.py' if command == 'build' else 'build_probe.py'
        subprocess.run([sys.executable, str(ROOT / script)], check=True)
    elif command == 'install-probe':
        print(bridge.run('install', '--no-incremental', str(LOCAL / 'build/probe.apk')))
        bridge.shell('pm','grant','local.qrbridge.probe','android.permission.CAMERA')
    else:
        print(bridge.shell('cat',f'{REMOTE}/host.log'))

JSON_COMMANDS = {
    'start': lambda bridge, args: bridge.start(args.display_mode, args.screen),
    'up': lambda bridge, args: bridge.up(args.package, args.display_mode),
    'open': lambda bridge, args: bridge.open(args.package, args.scan),
    'down': lambda bridge, args: bridge.down(args.log_path),
    'stop': lambda bridge, args: bridge.stop(),
    'cameras': lambda bridge, args: bridge.cameras(),
    'image': lambda bridge, args: bridge.request('image',data=base64.b64encode(args.path.read_bytes()).decode()),
    'camera-permission': lambda bridge, args: bridge.request(args.command,package=args.package),
    'grant-camera': lambda bridge, args: bridge.request(args.command,package=args.package),
    **dict.fromkeys(('tree','screenshot','capture-frame'), save_capture),
    'launch': run_display_command,
    **dict.fromkeys(('tap','text','key','long-press','swipe','scroll'), run_input_command),
}

def main():
    args = parse_args()
    bridge = Bridge(args.serial)
    if args.command in ('build','build-probe','install-probe','log'):
        print_plain(bridge, args.command)
        return
    handler = JSON_COMMANDS.get(args.command, lambda bridge, args: bridge.request(args.command))
    if args.command == 'open':
        try:
            result = handler(bridge, args)
        except (RuntimeError, OSError) as error:
            sys.exit(str(error).splitlines()[-1])
    else:
        result = handler(bridge, args)
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__ == '__main__':
    main()
