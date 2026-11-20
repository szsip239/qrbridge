package dev.qrbridge.wake;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import java.io.IOException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import io.github.muntashirakon.adb.android.AdbMdns;

final class LocalDiscovery {
    static int connectPort(Context context) throws InterruptedException, IOException {
        CountDownLatch found = new CountDownLatch(1);
        AtomicInteger port = new AtomicInteger();
        Handler main = new Handler(Looper.getMainLooper());
        // LibADB filters resolved hosts against this device's own network interfaces.
        AdbMdns discovery = new AdbMdns(context, AdbMdns.SERVICE_TYPE_TLS_CONNECT, (host, value) -> {
            if (value > 0) {
                port.set(value);
                found.countDown();
            }
        });
        main.post(discovery::start);
        try {
            if (!found.await(15, TimeUnit.SECONDS)) {
                throw new WakeFailure(WakeFlow.Result.NETWORK_APPROVAL);
            }
            return port.get();
        } finally {
            main.post(discovery::stop);
        }
    }
}
