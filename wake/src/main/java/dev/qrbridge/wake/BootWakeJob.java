package dev.qrbridge.wake;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Handler;
import android.os.Looper;

public final class BootWakeJob extends JobService {
    private static final int JOB_ID = 5555;
    private Thread worker;
    private boolean stopped;

    static void schedule(Context context) {
        NetworkRequest wifi = new NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build();
        JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(context, BootWakeJob.class))
                .setRequiredNetwork(wifi).build();
        if (context.getSystemService(JobScheduler.class).schedule(job) == JobScheduler.RESULT_FAILURE) {
            BootNotification.show(context, "后台未启动，请点开启");
        }
    }

    static void cancel(Context context) {
        context.getSystemService(JobScheduler.class).cancel(JOB_ID);
    }

    @Override public boolean onStartJob(JobParameters parameters) {
        stopped = false;
        WakeController controller = WakeController.get(this);
        Handler main = new Handler(Looper.getMainLooper());
        worker = new Thread(() -> {
            WakeFlow.Result result = controller.attempt(true);
            main.post(() -> {
                if (stopped) return;
                controller.update(result.message);
                BootNotification.show(this, result.message);
                jobFinished(parameters, false);
            });
        }, "wake-restore");
        worker.start();
        return true;
    }

    @Override public boolean onStopJob(JobParameters parameters) {
        stopped = true;
        worker.interrupt();
        String message = TcpipActivator.isRunning() ? WakeFlow.Result.RUNNING.message : "后台已停止，请点开启";
        WakeController.get(this).update(message);
        BootNotification.show(this, message);
        return false;
    }
}
