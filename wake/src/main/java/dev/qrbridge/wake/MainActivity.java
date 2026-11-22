package dev.qrbridge.wake;

import android.app.Activity;
import android.app.AlertDialog;
import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputFilter;
import android.text.InputType;
import android.view.Gravity;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.IOException;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

public final class MainActivity extends Activity {
    private WakeController controller;
    private Button enable;
    private TextView status;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        controller = WakeController.get(this);

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);
        int padding = dp(28);
        layout.setPadding(padding, padding, padding, padding);
        layout.setOnApplyWindowInsetsListener((view, insets) -> {
            android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars());
            view.setPadding(padding + bars.left, padding + bars.top, padding + bars.right, padding + bars.bottom);
            return insets;
        });
        enable = new Button(this);
        enable.setText("开启 5555");
        enable.setTextSize(22);
        enable.setOnClickListener(view -> enable());
        layout.addView(enable, new LinearLayout.LayoutParams(-1, dp(64)));
        status = new TextView(this);
        status.setTextSize(17);
        status.setGravity(Gravity.CENTER);
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(-1, -2);
        statusParams.topMargin = dp(24);
        layout.addView(status, statusParams);
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.addView(layout);
        setContentView(scroll);
        controller.listener = this::render;
        render();
        if (Build.VERSION.SDK_INT >= 33 && state == null
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                && !getPreferences(MODE_PRIVATE).getBoolean("notification_asked", false)) {
            getPreferences(MODE_PRIVATE).edit().putBoolean("notification_asked", true).apply();
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
    }

    private boolean checkWifi() {
        if (controller.wifi()) return true;
        controller.update("请先连接任意 Wi-Fi（包括别人的热点）");
        return false;
    }

    private void enable() {
        controller.enable(result -> {
            if (result.running()) BootWakeJob.cancel(this);
            else if (result == WakeFlow.Result.SETTINGS) openSettings();
            else if (result == WakeFlow.Result.PAIR && !isFinishing() && !isDestroyed()) showPairing();
        });
    }

    private void openSettings() {
        Intent intent = new Intent("android.settings.WIRELESS_DEBUGGING_SETTINGS");
        if (intent.resolveActivity(getPackageManager()) == null) {
            intent = new Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS);
        }
        startActivity(intent);
    }

    private void showPairing() {
        if (!checkWifi()) return;
        LinearLayout fields = new LinearLayout(this);
        fields.setOrientation(LinearLayout.VERTICAL);
        fields.setPadding(dp(24), dp(8), dp(24), 0);
        TextView help = new TextView(this);
        help.setText("分屏打开系统「无线调试 → 使用配对码配对设备」。保持窗口打开，输入配对端口和六位码。");
        fields.addView(help);
        EditText port = numberField("配对端口", 5);
        fields.addView(port);
        EditText code = numberField("六位配对码", 6);
        fields.addView(code);
        ScrollView content = new ScrollView(this);
        content.addView(fields);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("首次配对")
                .setView(content).setNegativeButton("取消", null).setPositiveButton("配对", null).create();
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            String portValue = port.getText().toString();
            String codeValue = code.getText().toString();
            if (portValue.isEmpty() || Integer.parseInt(portValue) < 1 || Integer.parseInt(portValue) > 65535) {
                port.setError("配对端口不正确");
                return;
            }
            if (!codeValue.matches("[0-9]{6}")) {
                code.setError("请输入六位码");
                return;
            }
            if (!checkWifi()) return;
            controller.pair(Integer.parseInt(portValue), codeValue);
            code.getText().clear();
            dialog.dismiss();
        }));
        dialog.show();
    }

    private EditText numberField(String hint, int length) {
        EditText field = new EditText(this);
        field.setHint(hint);
        field.setInputType(InputType.TYPE_CLASS_NUMBER);
        field.setFilters(new InputFilter[]{new InputFilter.LengthFilter(length)});
        field.setSaveEnabled(false);
        field.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
        return field;
    }

    private void render() {
        enable.setEnabled(!controller.busy);
        status.setText(controller.message);
        invalidateOptionsMenu();
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        menu.add(0, 1, 0, "首次配对");
        menu.add(0, 2, 1, "无线调试设置");
        menu.add(0, 3, 2, "开源许可");
        return true;
    }

    @Override
    public boolean onPrepareOptionsMenu(Menu menu) {
        menu.findItem(1).setEnabled(!controller.busy);
        return super.onPrepareOptionsMenu(menu);
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        if (item.getItemId() == 1) showPairing();
        else if (item.getItemId() == 2) openSettings();
        else if (item.getItemId() == 3) showLicenses();
        else return super.onOptionsItemSelected(item);
        return true;
    }

    private void showLicenses() {
        try (InputStream input = getAssets().open("licenses/NOTICE.txt")) {
            BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8));
            StringBuilder text = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) text.append(line).append('\n');
            new AlertDialog.Builder(this).setTitle("开源许可").setMessage(text.toString()).setPositiveButton("关闭", null).show();
        } catch (IOException error) {
            throw new IllegalStateException(error);
        }
    }

    @Override
    protected void onDestroy() {
        controller.listener = null;
        super.onDestroy();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
