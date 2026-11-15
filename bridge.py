#!/usr/bin/env python3
"""二维码虚拟摄像头原型命令行。"""
import argparse
import base64
import json
import shlex
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LOCAL = ROOT / '.local'
REMOTE = '/data/local/tmp/android-qr-bridge'
# 专属的本地管理地址，不对应真实蓝牙设备。
ASSOCIATION_MAC = '02:00:00:51:52:42'

class Bridge:
    def __init__(self, serial):
        self.adb = ['adb'] + (['-s', serial] if serial else [])

    def run(self, *args):
        return subprocess.run(self.adb + list(args), check=True, capture_output=True).stdout.decode().strip()

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

    def start(self, display_mode):
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
                   f'{association} {display_mode} >{REMOTE}/host.log 2>&1 </dev/null & echo $! >{REMOTE}/host.pid; cat {REMOTE}/host.pid')
        return {'started_pid': self.run('shell', command), 'remote_log': f'{REMOTE}/host.log'}

    def stop(self):
        pid = self.shell('cat', f'{REMOTE}/host.pid')
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

    def down(self, log_path):
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text(self.shell('cat', f'{REMOTE}/host.log') + '\n')
        result = self.stop()
        self.shell('rm', '-r', REMOTE)
        return {**result, 'log_path': str(log_path)}

    def cameras(self):
        device = str(self.request('status')['device_id'])
        self.run('push', str(LOCAL / 'build/bridge.jar'), f'{REMOTE}/inventory.jar')
        output = self.run('shell', f'CLASSPATH={REMOTE}/inventory.jar app_process / local.qrbridge.CameraInventory {device}')
        return json.loads(output)

def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--serial', help='adb 设备序列号或无线 ip:port；省略时由 adb 按 ANDROID_SERIAL 或唯一设备选择')
    commands = parser.add_subparsers(dest='command', required=True)
    for name, help_text in [('build','构建主机程序'),('build-probe','构建测试探针及已知二维码'),
                            ('install-probe','安装测试探针并授予其默认设备相机权限'),
                            ('stop','停止主机程序并移除本原型的 association'),('status','查看虚拟设备与相机状态'),
                            ('log','读取主机程序原始日志'),('cameras','对照默认设备与虚拟设备可见的相机 ID')]:
        commands.add_parser(name, help=help_text)
    start = commands.add_parser('start',help='推送并后台启动主机程序')
    start.add_argument('--display-mode',choices=('legacy','trusted','isolated'),default='isolated',
                       help='isolated 为受信任独立显示组；legacy 与 trusted 用于对照诊断')
    up = commands.add_parser('up', help='启动主机、等待就绪、为目标包授予虚拟设备 CAMERA 并在虚拟屏幕启动它')
    up.add_argument('package')
    up.add_argument('--display-mode',choices=('legacy','trusted','isolated'),default='isolated')
    commands.add_parser('down', help='保存主机日志后停止主机并删除手机端临时目录').add_argument('log_path', type=Path)
    commands.add_parser('image', help='送入 PNG 或 JPEG 图片').add_argument('path', type=Path)
    commands.add_parser('screenshot', help='保存虚拟屏幕 PNG').add_argument('path', type=Path)
    commands.add_parser('capture-frame', help='一次性保存实际交付的相机帧及时间戳元数据').add_argument('directory', type=Path)
    commands.add_parser('tree', help='保存同一虚拟屏幕的控件树 JSON').add_argument('path', type=Path)
    commands.add_parser('launch', help='在虚拟屏幕启动指定组件；不自动结束原任务').add_argument('component')
    tap = commands.add_parser('tap', help='点击虚拟屏幕坐标')
    tap.add_argument('x', type=int)
    tap.add_argument('y', type=int)
    commands.add_parser('text', help='通过 adb input 输入文字，中文支持受 input 限制').add_argument('text')
    commands.add_parser('key', help='向虚拟屏幕发送 Android 按键名或编号').add_argument('key')
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
    if args.command == 'launch':
        output = bridge.shell('am','start','-W','--display',display,'-n',args.component)
    else:
        if args.command == 'tap':
            values = ['tap',str(args.x),str(args.y)]
        elif args.command == 'text':
            values = ['text',args.text]
        else:
            values = ['keyevent',args.key]
        output = bridge.shell('input','-d',display,*values)
    return {'display_id':int(display),'output':output}

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
    'start': lambda bridge, args: bridge.start(args.display_mode),
    'up': lambda bridge, args: bridge.up(args.package, args.display_mode),
    'down': lambda bridge, args: bridge.down(args.log_path),
    'stop': lambda bridge, args: bridge.stop(),
    'cameras': lambda bridge, args: bridge.cameras(),
    'image': lambda bridge, args: bridge.request('image',data=base64.b64encode(args.path.read_bytes()).decode()),
    'camera-permission': lambda bridge, args: bridge.request(args.command,package=args.package),
    'grant-camera': lambda bridge, args: bridge.request(args.command,package=args.package),
    **dict.fromkeys(('tree','screenshot','capture-frame'), save_capture),
    **dict.fromkeys(('launch','tap','text','key'), run_display_command),
}

def main():
    args = parse_args()
    bridge = Bridge(args.serial)
    if args.command in ('build','build-probe','install-probe','log'):
        print_plain(bridge, args.command)
        return
    handler = JSON_COMMANDS.get(args.command, lambda bridge, args: bridge.request(args.command))
    print(json.dumps(handler(bridge, args),ensure_ascii=False,indent=2))

if __name__ == '__main__':
    main()
