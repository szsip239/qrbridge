package local.qrbridge;

import java.lang.reflect.Method;
import java.util.Arrays;

final class ClipboardAccess {
    private static final String PACKAGE = "com.android.shell";
    private final Object service;
    private final int deviceId;
    private final Method set;
    private final Method get;
    private final Method listen;

    ClipboardAccess(Object service, Class<?> api, Class<?> clipType, Class<?> listenerType, int deviceId) throws NoSuchMethodException {
        this.service = service;
        this.deviceId = deviceId;
        set = select(api,"setPrimaryClip",
                new Class<?>[]{clipType,String.class,String.class,int.class,int.class},
                new Class<?>[]{clipType,String.class,String.class,int.class,int.class,boolean.class});
        get = select(api,"getPrimaryClip",
                new Class<?>[]{String.class,String.class,int.class,int.class},
                new Class<?>[]{String.class,String.class,String.class,String.class,int.class,int.class,boolean.class});
        listen = api.getMethod("addPrimaryClipChangedListener",listenerType,String.class,String.class,int.class,int.class);
    }

    void setPrimaryClip(Object clip) throws ReflectiveOperationException {
        if (set.getParameterCount() == 6) set.invoke(service,clip,PACKAGE,null,0,deviceId,true);
        else set.invoke(service,clip,PACKAGE,null,0,deviceId);
    }

    Object getPrimaryClip() throws ReflectiveOperationException {
        if (get.getParameterCount() == 7) return get.invoke(service,PACKAGE,null,null,null,0,deviceId,true);
        return get.invoke(service,PACKAGE,null,0,deviceId);
    }

    void addPrimaryClipChangedListener(Object listener) throws ReflectiveOperationException {
        listen.invoke(service,listener,PACKAGE,null,0,deviceId);
    }

    private static Method select(Class<?> api, String name, Class<?>[]... signatures) throws NoSuchMethodException {
        for (Class<?>[] signature : signatures) {
            for (Method method : api.getMethods()) {
                if (method.getName().equals(name) && Arrays.equals(method.getParameterTypes(),signature)) return method;
            }
        }
        throw new NoSuchMethodException(api.getName() + "." + name + ": " + Arrays.toString(api.getMethods()));
    }
}
