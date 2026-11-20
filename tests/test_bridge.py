import struct
from argparse import Namespace
import unittest
from unittest.mock import Mock, call, patch

import bridge


class SelectionTests(unittest.TestCase):
    def test_scan_labels(self):
        for label in ('扫一扫', '掃一掃', ' Scan ', 'SCAN', '扫 一 扫'):
            with self.subTest(label=label):
                items = [{'text': 'New Chat', 'bounds': [370, 200, 580, 250]},
                         {'text': label, 'bounds': [370, 510, 470, 550]}]
                self.assertEqual(bridge.scan_menu_position(items), (420, 530))

    def test_missing_or_ambiguous_scan_fails(self):
        for labels in ([], ['Scan QR code'], ['Scan', '扫一扫']):
            with self.subTest(labels=labels), self.assertRaisesRegex(RuntimeError, '未找到唯一'):
                bridge.scan_menu_position([{'text': text, 'bounds': [0, 0, 1, 1]} for text in labels])

    def test_plus_scales_with_title_bar(self):
        self.assertEqual(bridge.wechat_plus_position(720, 240), (648, 68))
        self.assertEqual(bridge.wechat_plus_position(720, 320), (624, 90))

    def test_top_activity_is_scoped_to_display(self):
        dump = '''Display #0 (activities from top to bottom):
    topResumedActivity=ActivityRecord{abc u0 com.tencent.mm/.plugin.scanner.ui.BaseScanUI t1 d0}
Display #3 (activities from top to bottom):
    mLastPausedActivity: ActivityRecord{abc u0 com.tencent.mm/.plugin.scanner.ui.BaseScanUI t1 d3}
    topResumedActivity=ActivityRecord{def u0 com.tencent.mm/.ui.LauncherUI t2 d3}
Display #2 (activities from top to bottom):
  ResumedActivity: ActivityRecord{abc u0 com.tencent.mm/.plugin.scanner.ui.BaseScanUI t1 d0}
'''
        self.assertEqual(bridge.top_activity(dump, 3), bridge.WECHAT_MAIN)
        self.assertEqual(bridge.top_activity(dump, 0), bridge.SCANNERS[bridge.WECHAT])
        self.assertIsNone(bridge.top_activity(dump, 2))
        self.assertIsNone(bridge.top_activity(dump, 9))

    def test_original_app_uses_id_and_bounds(self):
        tree = {'windows': [{'id': 'root', 'children': [
            {'id': 'com.vivo.doubleinstance:id/clone', 'bounds': '360 1062 678 1175', 'children': []},
            {'id': 'com.vivo.doubleinstance:id/main', 'bounds': '42 1062 360 1175', 'children': []},
        ]}]}
        self.assertEqual(bridge.original_app_position(tree), (201, 1118))


class OpenTests(unittest.TestCase):
    def setUp(self):
        self.bridge = bridge.Bridge(None)
        for name in ('run', 'shell', 'start', 'wait_ready', 'request', 'wait_activity', 'tap', 'screenshot', 'launcher'):
            setattr(self.bridge, name, Mock())
        self.bridge.run.return_value = 'running'
        self.bridge.request.return_value = {'display_id': 3}
        self.bridge.launcher.return_value = 'local.test/.Main'
        self.bridge.wait_activity.return_value = 'local.test/local.test.Main'

    def test_reuses_host_and_launches_package(self):
        result = self.bridge.open('local.test')
        self.assertEqual(result, {'started': False, 'opened': 'local.test/local.test.Main', 'scanning': False})
        self.bridge.start.assert_not_called()
        self.bridge.request.assert_has_calls([call('status'), call('grant-camera', package='local.test')])
        self.bridge.shell.assert_called_once_with('am', 'start', '-W', '--display', '3', '-n', 'local.test/.Main')

    def test_starts_missing_host_and_waits(self):
        self.bridge.run.return_value = ''
        self.assertTrue(self.bridge.open('local.test')['started'])
        self.bridge.start.assert_called_once_with('isolated')
        self.bridge.wait_ready.assert_called_once_with()

    def test_alipay_uri_is_pinned_and_scanner_required(self):
        scanner = bridge.SCANNERS[bridge.ALIPAY]
        self.bridge.wait_activity.return_value = scanner
        self.assertEqual(self.bridge.open(bridge.ALIPAY, True)['opened'], scanner)
        self.bridge.shell.assert_called_once_with(
            'am', 'start', '-W', '--display', '3', '-a', 'android.intent.action.VIEW',
            '-d', 'alipays://platformapi/startapp?saId=10000007', '-p', bridge.ALIPAY)
        accepts = self.bridge.wait_activity.call_args.args[1]
        self.assertTrue(accepts(scanner))
        self.assertFalse(accepts(bridge.WECHAT_MAIN))

    @patch('bridge.recognize_screen', return_value={'observations': [{'text': 'Scan', 'bounds': [370, 510, 470, 550]}]})
    @patch('bridge.build_ocr', return_value='ocr-binary')
    def test_wechat_chooses_original_then_ocr_menu(self, build, recognize):
        scanner = bridge.SCANNERS[bridge.WECHAT]
        self.bridge.wait_activity.side_effect = [bridge.DOUBLE_APP, bridge.WECHAT_MAIN, bridge.WECHAT_MAIN, scanner]
        self.bridge.request.side_effect = [
            {'display_id': 3, 'density': 240}, {'granted': True},
            {'windows': [{'id': 'com.vivo.doubleinstance:id/main', 'bounds': '42 1062 360 1175', 'children': []}]},
        ]
        self.bridge.screenshot.return_value = b'\0' * 16 + struct.pack('>II', 720, 1280)
        with patch('bridge.time.sleep'):
            self.assertEqual(self.bridge.open(bridge.WECHAT, True),
                             {'started': False, 'opened': scanner, 'scanning': True})
        self.bridge.tap.assert_has_calls([call(3, (201, 1118)), call(3, (648, 68)), call(3, (420, 530))])
        self.bridge.shell.assert_called_once_with('am', 'start', '-W', '--display', '3', '-n', 'com.tencent.mm/.ui.LauncherUI')
        recognize.assert_called_once_with('ocr-binary', self.bridge.screenshot.return_value)

    @patch('bridge.recognize_screen', side_effect=[{'observations': []}, {'observations': [{'text': '扫一扫', 'bounds': [370, 510, 470, 550]}]}])
    def test_plus_is_tapped_again_until_the_menu_shows_scan(self, recognize):
        self.bridge.screenshot.return_value = b'\0' * 16 + struct.pack('>II', 720, 1280)
        with patch('bridge.time.sleep'):
            self.assertEqual(bridge.Bridge.scan_menu(self.bridge, 3, 240, 'ocr'), (420, 530))
        self.assertEqual(self.bridge.tap.call_args_list, [call(3, (648, 68))] * 2)

    def test_chooser_tap_is_repeated_until_the_sheet_closes(self):
        tree = {'windows': [{'id': 'com.vivo.doubleinstance:id/main', 'bounds': '42 1062 360 1175', 'children': []}]}
        self.bridge.request.return_value = tree
        self.bridge.wait_activity.side_effect = [RuntimeError('still open'), bridge.WECHAT_MAIN]
        with patch('bridge.time.sleep'):
            self.assertEqual(bridge.Bridge.choose_original(self.bridge, 3), bridge.WECHAT_MAIN)
        self.assertEqual(self.bridge.tap.call_args_list, [call(3, (201, 1118))] * 2)

    def test_unsupported_scan_fails_before_phone_access(self):
        with self.assertRaisesRegex(RuntimeError, '仅支持微信和支付宝'):
            self.bridge.open('local.test', True)
        self.bridge.run.assert_not_called()

    def test_wait_activity_times_out_without_claiming_scan(self):
        self.bridge.shell.return_value = 'Display #3 (activities from top to bottom):'
        with patch('bridge.time.monotonic', side_effect=[0, 0, 16]), patch('bridge.time.sleep'):
            with self.assertRaisesRegex(RuntimeError, '未进入扫一扫'):
                bridge.Bridge.wait_activity(self.bridge, 3, lambda top: top == bridge.SCANNERS[bridge.WECHAT], '未进入扫一扫')


class InputTests(unittest.TestCase):
    def test_inputs_go_directly_to_the_host_without_status_or_input_shell_calls(self):
        target = Mock()
        for command, payload in [
            ('text', {'text': '中文🙂\nnext'}),
            ('key', {'key': 'KEYCODE_DEL'}),
            ('tap', {'x': 10, 'y': 20}),
            ('long-press', {'x': 10, 'y': 20, 'duration': 600}),
            ('swipe', {'x': 10, 'y': 20, 'end_x': 30, 'end_y': 40, 'duration': 300}),
            ('scroll', {'x': 10, 'y': 20, 'delta_x': 0, 'delta_y': 2}),
        ]:
            with self.subTest(command=command):
                bridge.run_input_command(target, Namespace(command=command, serial=None, **payload))
                target.request.assert_called_with(command, **payload)
        self.assertEqual(target.request.call_count, 6)
        target.shell.assert_not_called()


if __name__ == '__main__':
    unittest.main()
