package local.qrbridge;

import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public final class ClipboardAccessTest {
    public static final class Clip {}
    public interface Listener {}
    public interface Aosp {
        void setPrimaryClip(Clip clip, String pkg, String tag, int user, int device);
        Clip getPrimaryClip(String pkg, String tag, int user, int device);
        void addPrimaryClipChangedListener(Listener listener, String pkg, String tag, int user, int device);
    }
    public interface Vivo {
        void setPrimaryClip(Clip clip, String pkg, String tag, int user, int device, boolean userOperate);
        Clip getPrimaryClip(String pkg, String tag, String extra1, String extra2, int user, int device, boolean userOperate);
        void addPrimaryClipChangedListener(Listener listener, String pkg, String tag, int user, int device);
    }
    public interface Unknown {
        void setPrimaryClip(Clip clip, String pkg, String tag, int user, int device, String unknown);
    }

    static void exercise(Class<?> api) throws Exception {
        Clip clip = new Clip();
        Listener listener = new Listener() {};
        List<Object[]> calls = new ArrayList<>();
        Object service = Proxy.newProxyInstance(api.getClassLoader(),new Class<?>[]{api},(proxy,method,args) -> {
            calls.add(args);
            return method.getName().equals("getPrimaryClip") ? clip : null;
        });
        ClipboardAccess access = new ClipboardAccess(service,api,Clip.class,Listener.class,77);
        access.setPrimaryClip(clip);
        assert access.getPrimaryClip() == clip;
        access.addPrimaryClipChangedListener(listener);
        Object[] setArgs = api == Vivo.class ? new Object[]{clip,"com.android.shell",null,0,77,true} : new Object[]{clip,"com.android.shell",null,0,77};
        Object[] getArgs = api == Vivo.class ? new Object[]{"com.android.shell",null,null,null,0,77,true} : new Object[]{"com.android.shell",null,0,77};
        assert Arrays.equals(calls.get(0),setArgs) : Arrays.toString(calls.get(0));
        assert Arrays.equals(calls.get(1),getArgs) : Arrays.toString(calls.get(1));
        assert Arrays.equals(calls.get(2),new Object[]{listener,"com.android.shell",null,0,77});
        assert calls.size() == 3;
    }

    public static void main(String[] args) throws Exception {
        exercise(Aosp.class);
        exercise(Vivo.class);
        try {
            new ClipboardAccess(null,Unknown.class,Clip.class,Listener.class,77);
            throw new AssertionError("Unknown clipboard methods must surface, not be guessed");
        } catch (NoSuchMethodException expected) {
            assert expected.getMessage().contains("setPrimaryClip");
        }
        System.out.println("AOSP and observed vivo clipboard signatures passed");
    }
}
