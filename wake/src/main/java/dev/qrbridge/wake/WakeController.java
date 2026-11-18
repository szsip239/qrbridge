package dev.qrbridge.wake;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;

import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

import io.github.muntashirakon.adb.AdbAuthenticationFailedException;
import io.github.muntashirakon.adb.AdbPairingRequiredException;
import io.github.muntashirakon.adb.AdbStream;

final class WakeController implements WakeFlow.Device {
    private static WakeController instance;
    private final Context context;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    Runnable listener;
    boolean busy;
    String message;

    static WakeController get(Context context) {
        if (instance == null) instance = new WakeController(context);
        return instance;
    }

    private WakeController(Context context) {
        this.context = context.getApplicationContext();
        message = paired() ? "点一下，开启 5555" : "请从菜单配对";
    }

    @Override public boolean running() { return TcpipActivator.isRunning(); }

    @Override public boolean paired() {
        return context.getSharedPreferences("wake", Context.MODE_PRIVATE).getBoolean("paired", false);
    }

    @Override public boolean wifi() {
        ConnectivityManager manager = context.getSystemService(ConnectivityManager.class);
        for (Network network : manager.getAllNetworks()) {
            NetworkCapabilities caps = manager.getNetworkCapabilities(network);
            if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                    && !caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) return true;
        }
        return false;
    }

    @Override public boolean wireless() {
        return Settings.Global.getInt(context.getContentResolver(), "adb_wifi_enabled", 0) == 1;
    }

    @Override public boolean granted() {
        return context.checkSelfPermission(Manifest.permission.WRITE_SECURE_SETTINGS) == PackageManager.PERMISSION_GRANTED;
    }

    @Override public boolean setWireless(boolean enabled) {
        return Settings.Global.putInt(context.getContentResolver(), "adb_wifi_enabled", enabled ? 1 : 0);
    }

    @Override public void openPort() throws Exception {
        update("正在连接…");
        int port = LocalDiscovery.connectPort(context);
        try (AdbIdentity adb = new AdbIdentity(context)) {
            if (!adb.connect("127.0.0.1", port)) throw new WakeFailure(WakeFlow.Result.CONNECT);
            update("正在开启…");
            TcpipActivator.activate(() -> {
                try (AdbStream stream = adb.openStream("tcpip:5555")) {
                    // Opening this service sends the request without a shell command.
                }
            }, TcpipActivator::awaitLocalPort);
        }
    }

    void enable(Consumer<WakeFlow.Result> completed) {
        submit("正在检查…", () -> WakeFlow.run(this, false), completed);
    }

    WakeFlow.Result attempt(boolean automatic) {
        return execute(() -> WakeFlow.run(this, automatic));
    }

    private WakeFlow.Result execute(Operation operation) {
        try {
            return operation.run();
        } catch (WakeFailure error) {
            return error.result;
        } catch (AdbPairingRequiredException | AdbAuthenticationFailedException error) {
            return WakeFlow.Result.PAIR;
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            return WakeFlow.Result.ERROR;
        } catch (Exception error) {
            Log.e("QRBridgeWake", "开启失败", error);
            return WakeFlow.Result.ERROR;
        }
    }

    void pair(int port, String code) {
        submit("正在配对…", () -> {
            try (AdbIdentity adb = new AdbIdentity(context)) {
                if (!adb.pair("127.0.0.1", port, code)) throw new IOException("Pairing failed");
            }
            context.getSharedPreferences("wake", Context.MODE_PRIVATE).edit().putBoolean("paired", true).apply();
            return WakeFlow.Result.SUCCESS;
        }, result -> {
            if (result == WakeFlow.Result.SUCCESS) update("配对成功");
        });
    }

    private interface Operation { WakeFlow.Result run() throws Exception; }

    private void submit(String starting, Operation operation, Consumer<WakeFlow.Result> completed) {
        busy = true;
        update(starting);
        executor.execute(() -> {
            WakeFlow.Result finished = execute(operation);
            main.post(() -> {
                busy = false;
                update(finished.message);
                completed.accept(finished);
            });
        });
    }

    void update(String value) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            main.post(() -> update(value));
            return;
        }
        message = value;
        if (listener != null) listener.run();
    }
}
