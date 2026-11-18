package dev.qrbridge.wake;

final class WakeFlow {
    enum Result {
        SUCCESS("成功"), RUNNING("5555 已在运行"),
        WIFI("请先连接任意 Wi-Fi（包括别人的热点）"),
        SETTINGS("请打开无线调试，再点开启"), PAIR("请先配对"),
        GRANT("请先授予调试开关权限"),
        NETWORK_APPROVAL("等待超时。请允许此网络调试，再点开启"),
        CONNECT("连接超时，请再点开启"),
        ENABLE_FAILED("无线调试未能开启"), RESTORE_FAILED("无线调试未能关闭，请手动关闭"),
        ERROR("开启失败，请再试");

        final String message;
        Result(String message) { this.message = message; }
        boolean running() { return this == SUCCESS || this == RUNNING; }
    }

    interface Device {
        boolean running();
        boolean wifi();
        boolean paired();
        boolean granted();
        boolean wireless();
        boolean setWireless(boolean enabled);
        void openPort() throws Exception;
    }

    static synchronized Result run(Device device, boolean automatic) throws Exception {
        if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
        if (device.running()) return Result.RUNNING;
        if (!device.wifi()) return Result.WIFI;
        if (automatic && !device.granted()) return Result.GRANT;
        boolean wireless = device.wireless();
        if (!wireless && !device.granted()) return Result.SETTINGS;
        if (!device.paired()) return Result.PAIR;

        boolean changed = false;
        try {
            if (!wireless) {
                if (!device.setWireless(true)) return Result.ENABLE_FAILED;
                changed = true;
            }
            device.openPort();
        } finally {
            if (changed && !device.setWireless(false)) {
                throw new WakeFailure(Result.RESTORE_FAILED);
            }
        }
        return device.running() ? Result.SUCCESS : Result.ERROR;
    }
}
