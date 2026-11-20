package dev.qrbridge.wake;

import android.content.Context;
import android.os.Build;

import org.bouncycastle.asn1.x500.X500Name;
import org.bouncycastle.cert.jcajce.JcaX509CertificateConverter;
import org.bouncycastle.cert.jcajce.JcaX509v3CertificateBuilder;
import org.bouncycastle.operator.jcajce.JcaContentSignerBuilder;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.math.BigInteger;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.SecureRandom;
import java.security.cert.Certificate;
import java.util.Date;
import java.util.concurrent.TimeUnit;

import io.github.muntashirakon.adb.AbsAdbConnectionManager;

final class AdbIdentity extends AbsAdbConnectionManager {
    private final PrivateKey privateKey;
    private final Certificate certificate;

    AdbIdentity(Context context) throws Exception {
        File file = new File(context.getNoBackupFilesDir(), "adb-identity.p12");
        KeyStore store = KeyStore.getInstance("PKCS12");
        char[] password = new char[0];
        if (file.exists()) {
            try (FileInputStream input = new FileInputStream(file)) {
                store.load(input, password);
            }
        } else {
            store.load(null, password);
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048);
            KeyPair pair = generator.generateKeyPair();
            X500Name name = new X500Name("CN=QRBridge Wake");
            long now = System.currentTimeMillis();
            Certificate cert = new JcaX509CertificateConverter().getCertificate(
                    new JcaX509v3CertificateBuilder(name, new BigInteger(128, new SecureRandom()),
                            new Date(now - TimeUnit.DAYS.toMillis(1)),
                            new Date(now + TimeUnit.DAYS.toMillis(3650)), name, pair.getPublic())
                            .build(new JcaContentSignerBuilder("SHA256withRSA").build(pair.getPrivate())));
            store.setKeyEntry("adb", pair.getPrivate(), password, new Certificate[]{cert});
            try (FileOutputStream output = new FileOutputStream(file)) {
                store.store(output, password);
            }
        }
        privateKey = (PrivateKey) store.getKey("adb", password);
        certificate = store.getCertificate("adb");
        setApi(Build.VERSION.SDK_INT);
        setTimeout(10, TimeUnit.SECONDS);
        setThrowOnUnauthorised(true);
    }

    @Override protected PrivateKey getPrivateKey() { return privateKey; }
    @Override protected Certificate getCertificate() { return certificate; }
    @Override protected String getDeviceName() { return "QRBridge Wake"; }
}
