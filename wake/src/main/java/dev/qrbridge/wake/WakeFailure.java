package dev.qrbridge.wake;

import java.io.IOException;

final class WakeFailure extends IOException {
    final WakeFlow.Result result;
    WakeFailure(WakeFlow.Result result) {
        super(result.message);
        this.result = result;
    }
}
