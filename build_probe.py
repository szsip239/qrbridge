#!/usr/bin/env python3
"""构建仅申请相机权限的 Camera1／Camera2 二维码探针。"""
import subprocess
import sys
import urllib.request
import zipfile
sys.dont_write_bytecode = True
from build import ROOT, BUILD, SDK

BUILD.mkdir(parents=True, exist_ok=True)
zxing = BUILD / 'zxing-core-3.5.3.jar'
if not zxing.exists():
    urllib.request.urlretrieve('https://repo.maven.apache.org/maven2/com/google/zxing/core/3.5.3/core-3.5.3.jar',zxing)
android = SDK / 'platforms/android-36/android.jar'
tools = SDK / 'build-tools/36.0.0'
classes = BUILD / 'probe-classes'
classes.mkdir(exist_ok=True)
subprocess.run(['javac','--release','17','-cp',f'{android}:{zxing}','-d',str(classes),str(ROOT/'src/ProbeActivity.java')],check=True)
jar = BUILD / 'probe-classes.jar'
with zipfile.ZipFile(jar,'w') as output:
    for path in classes.rglob('*.class'):
        output.write(path,path.relative_to(classes))
dex = BUILD / 'probe-dex'
dex.mkdir(exist_ok=True)
subprocess.run([str(tools/'d8'),'--min-api','36','--lib',str(android),'--output',str(dex),str(jar),str(zxing)],check=True)
unsigned = BUILD / 'probe-unsigned.apk'
subprocess.run([str(tools/'aapt2'),'link','--manifest',str(ROOT/'src/AndroidManifest.xml'),'-I',str(android),'--min-sdk-version','36','--target-sdk-version','36','-o',str(unsigned)],check=True)
with zipfile.ZipFile(unsigned,'a') as output:
    output.write(dex/'classes.dex','classes.dex')
aligned = BUILD/'probe-aligned.apk'
subprocess.run([str(tools/'zipalign'),'-f','4',str(unsigned),str(aligned)],check=True)
key = BUILD/'probe.keystore'
if not key.exists():
    subprocess.run(['keytool','-genkeypair','-keystore',str(key),'-storepass','android','-keypass','android','-alias','probe','-dname','CN=二维码桥接实验','-keyalg','RSA','-validity','3650'],check=True)
apk = BUILD/'probe.apk'
subprocess.run([str(tools/'apksigner'),'sign','--ks',str(key),'--ks-pass','pass:android','--out',str(apk),str(aligned)],check=True)
subprocess.run(['javac','-cp',str(zxing),'-d',str(BUILD),str(ROOT/'src/QrImage.java')],check=True)
subprocess.run(['java','-Djava.awt.headless=true','-cp',f'{BUILD}:{zxing}','QrImage','android-qr-bridge:gate2:2026-11-15',str(BUILD/'known-qr.png')],check=True)
print(apk)
