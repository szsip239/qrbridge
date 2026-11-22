import subprocess
import tempfile
import unittest
from pathlib import Path


class ClipboardAccessTests(unittest.TestCase):
    def test_aosp_and_observed_vivo_signatures_preserve_the_virtual_device(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory(prefix='qrbridge-clipboard-') as classes:
            subprocess.run(['javac', '--release', '17', '-d', classes,
                            str(root / 'src/ClipboardAccess.java'),
                            str(root / 'tests/java/ClipboardAccessTest.java')], check=True)
            subprocess.run(['java', '-ea', '-cp', classes, 'local.qrbridge.ClipboardAccessTest'], check=True)
