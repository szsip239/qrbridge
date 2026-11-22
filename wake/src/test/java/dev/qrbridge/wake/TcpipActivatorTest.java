package dev.qrbridge.wake;

import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertThrows;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import org.junit.Test;

public class TcpipActivatorTest {
    @Test
    public void verifiesListenerAfterDaemonClosesItsOwnTransport() throws Exception {
        List<String> order = new ArrayList<>();
        TcpipActivator.activate(() -> {
            order.add("request");
            throw new IOException("adbd restart");
        }, () -> {
            order.add("probe");
            return true;
        });
        org.junit.Assert.assertEquals(List.of("request", "probe"), order);
    }

    @Test
    public void acceptedRequestAloneDoesNotMeanSuccess() {
        assertThrows(IOException.class, () -> TcpipActivator.activate(() -> {}, () -> false));
    }

    @Test
    public void preservesRequestFailureWhenListenerDoesNotAppear() {
        IOException failure = new IOException("request rejected");
        assertSame(failure, assertThrows(IOException.class,
                () -> TcpipActivator.activate(() -> { throw failure; }, () -> false)));
    }
}
