package dev.qrbridge.wake;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                if (!TcpipActivator.isRunning()) BootWakeJob.schedule(context);
            } finally {
                pending.finish();
            }
        }, "wake-boot").start();
    }
}
