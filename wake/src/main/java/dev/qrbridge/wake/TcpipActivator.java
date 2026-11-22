package dev.qrbridge.wake;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.concurrent.TimeUnit;

final class TcpipActivator {
    interface Request {
        void send() throws IOException, InterruptedException;
    }

    interface Probe {
        boolean await() throws IOException, InterruptedException;
    }

    static void activate(Request request, Probe probe) throws IOException, InterruptedException {
        IOException requestFailure = null;
        try {
            request.send();
        } catch (IOException error) {
            // tcpip:5555 restarts adbd and can close its own TLS transport before replying.
            requestFailure = error;
        }
        if (probe.await()) return;
        if (requestFailure != null) throw requestFailure;
        throw new IOException("5555 未开启，请再试");
    }

    static boolean isRunning() {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress("127.0.0.1", 5555), 200);
            return true;
        } catch (IOException notListening) {
            return false;
        }
    }

    static boolean awaitLocalPort() throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        do {
            if (isRunning()) return true;
            // tcpip:5555 needs time to restart adbd.
            Thread.sleep(200);
        } while (System.nanoTime() < deadline);
        return false;
    }
}
