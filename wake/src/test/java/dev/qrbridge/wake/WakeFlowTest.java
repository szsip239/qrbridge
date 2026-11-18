package dev.qrbridge.wake;

import static org.junit.Assert.*;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

public class WakeFlowTest {
    @Test public void existingListenerSkipsEveryPrerequisiteAndSetting() throws Exception {
        Device device = new Device();
        device.running = true;
        assertEquals(WakeFlow.Result.RUNNING, WakeFlow.run(device, false));
        assertEquals(List.of("running"), device.calls);
        device.calls.clear();
        assertEquals(WakeFlow.Result.RUNNING, WakeFlow.run(device, true));
        assertEquals(List.of("running"), device.calls);
    }

    @Test public void noWifiDoesNotWriteSettings() throws Exception {
        Device device = new Device();
        device.wifi = false;
        assertEquals(WakeFlow.Result.WIFI, WakeFlow.run(device, false));
        assertEquals(List.of("running", "wifi"), device.calls);
    }

    @Test public void missingGrantRoutesManualUseToSettingsAndStopsAutomaticUse() throws Exception {
        Device device = new Device();
        device.grant = false;
        assertEquals(WakeFlow.Result.SETTINGS, WakeFlow.run(device, false));
        assertEquals(WakeFlow.Result.GRANT, WakeFlow.run(device, true));
        assertFalse(device.calls.contains("open"));
        assertFalse(device.wireless);
    }

    @Test public void restoresOnlyTheSwitchItTurnedOn() throws Exception {
        Device device = new Device();
        assertEquals(WakeFlow.Result.SUCCESS, WakeFlow.run(device, true));
        assertEquals(List.of(true, false), device.writes);
        assertFalse(device.wireless);
        Device alreadyEnabled = new Device();
        alreadyEnabled.wireless = true;
        assertEquals(WakeFlow.Result.SUCCESS, WakeFlow.run(alreadyEnabled, false));
        assertTrue(alreadyEnabled.writes.isEmpty());
        assertTrue(alreadyEnabled.wireless);
    }

    @Test public void failureAndInterruptionRestoreWirelessDebugging() {
        for (Exception failure : new Exception[]{new IOException("TLS failed"), new InterruptedException()}) {
            Device device = new Device();
            device.failure = failure;
            assertSame(failure, assertThrows(Exception.class, () -> WakeFlow.run(device, true)));
            assertEquals(List.of(true, false), device.writes);
            assertFalse(device.wireless);
        }
    }

    @Test public void aSecondTapCanContinueAfterNetworkApprovalTimeout() throws Exception {
        Device device = new Device();
        device.failure = new WakeFailure(WakeFlow.Result.NETWORK_APPROVAL);
        assertThrows(WakeFailure.class, () -> WakeFlow.run(device, false));
        device.failure = null;
        assertEquals(WakeFlow.Result.SUCCESS, WakeFlow.run(device, false));
        assertEquals(List.of(true, false, true, false), device.writes);
    }

    private static final class Device implements WakeFlow.Device {
        boolean running, wireless;
        boolean wifi = true, grant = true;
        Exception failure;
        final List<String> calls = new ArrayList<>();
        final List<Boolean> writes = new ArrayList<>();
        public boolean running() { calls.add("running"); return running; }
        public boolean wifi() { calls.add("wifi"); return wifi; }
        public boolean paired() { calls.add("paired"); return true; }
        public boolean granted() { calls.add("grant"); return grant; }
        public boolean wireless() { calls.add("wireless"); return wireless; }
        public boolean setWireless(boolean enabled) { writes.add(enabled); wireless = enabled; return true; }
        public void openPort() throws Exception {
            calls.add("open");
            if (failure != null) throw failure;
            running = true;
        }
    }
}
