#!/usr/bin/env python3
"""构建二维码桥接原型，不安装或操作手机。"""
import os
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent
BUILD = ROOT / '.local/build'
SDK = Path(os.environ.get('ANDROID_HOME', Path.home() / 'Library/Android/sdk'))

def main():
    BUILD.mkdir(parents=True, exist_ok=True)
    classes = BUILD / 'classes'
    classes.mkdir(exist_ok=True)
    android = SDK / 'platforms/android-36/android.jar'
    subprocess.run(['javac', '--release', '17', '-classpath', str(android),
                    '-d', str(classes), str(ROOT / 'src/BridgeHost.java'),
                    str(ROOT / 'src/ClipboardAccess.java'),
                    str(ROOT / 'src/CameraInventory.java')], check=True)
    jar = BUILD / 'classes.jar'
    with zipfile.ZipFile(jar, 'w') as output:
        for path in classes.rglob('*.class'):
            output.write(path, path.relative_to(classes))
    dex = BUILD / 'dex'
    dex.mkdir(exist_ok=True)
    subprocess.run([str(SDK / 'build-tools/36.0.0/d8'), '--min-api', '36',
                    '--lib', str(android), '--output', str(dex), str(jar)], check=True)
    target = BUILD / 'bridge.jar'
    with zipfile.ZipFile(target, 'w') as output:
        output.write(dex / 'classes.dex', 'classes.dex')
    print(target)

if __name__ == '__main__':
    main()
