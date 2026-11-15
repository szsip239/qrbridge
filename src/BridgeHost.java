package local.qrbridge;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.UiAutomation;
import android.content.AttributionSource;
import android.content.Context;
import android.content.ContextWrapper;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.RectF;
import android.hardware.display.VirtualDisplay;
import android.hardware.display.VirtualDisplayConfig;
import android.hardware.display.DisplayManager;
import android.media.Image;
import android.media.ImageReader;
import android.net.LocalServerSocket;
import android.net.LocalSocket;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.util.Base64;
import android.view.Surface;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.lang.reflect.*;
import java.util.*;
import java.util.concurrent.Executor;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public final class BridgeHost {
    static Object device;
    static Object camera;
    static VirtualDisplay display;
    static ImageReader reader;
    static volatile Bitmap frame;
    static volatile Bitmap screen;
    static final Map<Integer, Surface> streams = new HashMap<>();
    static UiAutomation automation;
    static HandlerThread uiThread;
    static int displayId;
    static String displayMode;
    static final AtomicReference<CompletableFuture<JSONObject>> pendingCapture = new AtomicReference<>();

    static Object call(Object target, String method, Class<?>[] types, Object... args) throws Exception {
        return target.getClass().getMethod(method, types).invoke(target, args);
    }

    static Object build(Object builder) throws Exception {
        return call(builder, "build", new Class<?>[0]);
    }

    static int constant(Class<?> type, String name) throws Exception {
        return type.getField(name).getInt(null);
    }

    static final class ShellContext extends ContextWrapper {
        ShellContext(Context base) { super(base); }
        public String getPackageName() { return "com.android.shell"; }
        public String getOpPackageName() { return getPackageName(); }
        public AttributionSource getAttributionSource() {
            return new AttributionSource.Builder(2000).setPackageName(getPackageName()).build();
        }
        public Context getApplicationContext() { return this; }
    }

    static void paintFrame(Canvas canvas, Bitmap image) {
        canvas.drawColor(Color.WHITE);
        if (image == null) return;
        float scale = Math.min((float) canvas.getWidth() / image.getWidth(),
                (float) canvas.getHeight() / image.getHeight());
        float w = image.getWidth() * scale, h = image.getHeight() * scale;
        float x = (canvas.getWidth() - w) / 2, y = (canvas.getHeight() - h) / 2;
        canvas.drawBitmap(image, null, new RectF(x, y, x + w, y + h), new Paint());
    }

    static void draw(int id, Long frameId) throws Exception {
        Surface surface = streams.get(id);
        if (surface == null) return;
        CompletableFuture<JSONObject> capture = frameId == null ? null : pendingCapture.getAndSet(null);
        Bitmap delivered = null;
        Canvas canvas = surface.lockHardwareCanvas();
        try {
            Bitmap image = frame;
            if (capture == null) {
                paintFrame(canvas,image);
            } else {
                delivered = Bitmap.createBitmap(canvas.getWidth(),canvas.getHeight(),Bitmap.Config.ARGB_8888);
                paintFrame(new Canvas(delivered),image);
                canvas.drawBitmap(delivered,0,0,null);
            }
        } finally {
            surface.unlockCanvasAndPost(canvas);
        }
        if (capture != null) {
            long timestamp = System.currentTimeMillis();
            ByteArrayOutputStream png = new ByteArrayOutputStream();
            delivered.compress(Bitmap.CompressFormat.PNG,100,png);
            capture.complete(new JSONObject().put("timestamp_ms",timestamp)
                    .put("timestamp_utc",java.time.Instant.ofEpochMilli(timestamp).toString())
                    .put("stream_id",id).put("frame_id",frameId).put("display_id",displayId)
                    .put("camera_id",call(camera,"getId",new Class<?>[0]))
                    .put("width",delivered.getWidth()).put("height",delivered.getHeight())
                    .put("data",Base64.encodeToString(png.toByteArray(),Base64.NO_WRAP)));
            delivered.recycle();
        }
    }

    static JSONObject captureFrame() throws Exception {
        if (streams.isEmpty()) throw new IllegalStateException("相机尚无消费方，先启动取景");
        CompletableFuture<JSONObject> capture = new CompletableFuture<>();
        pendingCapture.set(capture);
        try {
            return capture.get(10,TimeUnit.SECONDS);
        } finally {
            pendingCapture.compareAndSet(capture,null);
        }
    }

    static Context shellContext() throws Exception {
        Class<?> activityThread = Class.forName("android.app.ActivityThread");
        Object thread = activityThread.getMethod("systemMain").invoke(null);
        return new ShellContext((Context) call(thread, "getSystemContext", new Class<?>[0]));
    }

    static void observeActivities() throws Exception {
        Class<?> type = Class.forName("android.companion.virtual.VirtualDeviceManager$ActivityListener");
        Object listener = Proxy.newProxyInstance(type.getClassLoader(),new Class<?>[]{type},(proxy,method,args) -> {
            switch (method.getName()) {
                case "hashCode": return System.identityHashCode(proxy);
                case "equals": return proxy == args[0];
                case "toString": return "二维码桥接活动监听";
                default: System.out.println("ACTIVITY " + method.getName() + " " + Arrays.toString(args));
            }
            return null;
        });
        call(device,"addActivityListener",new Class<?>[]{Executor.class,type},(Executor) Runnable::run,listener);
    }

    static int displayFlags() throws Exception {
        int flags = DisplayManager.VIRTUAL_DISPLAY_FLAG_PUBLIC | DisplayManager.VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY;
        if (!displayMode.equals("legacy")) flags |= constant(DisplayManager.class,"VIRTUAL_DISPLAY_FLAG_TRUSTED");
        if (displayMode.equals("isolated")) flags |= constant(DisplayManager.class,"VIRTUAL_DISPLAY_FLAG_OWN_DISPLAY_GROUP")
                | constant(DisplayManager.class,"VIRTUAL_DISPLAY_FLAG_ALWAYS_UNLOCKED");
        return flags;
    }

    static void create(int association) throws Exception {
        Context context = shellContext();
        Object binder = Class.forName("android.os.ServiceManager")
                .getMethod("getService", String.class).invoke(null, "virtualdevice");
        Class<?> serviceType = Class.forName("android.companion.virtual.IVirtualDeviceManager");
        Object service = Class.forName(serviceType.getName() + "$Stub")
                .getMethod("asInterface", android.os.IBinder.class).invoke(null, binder);
        Object manager = Class.forName("android.companion.virtual.VirtualDeviceManager")
                .getConstructor(serviceType, Context.class).newInstance(service, context);
        Class<?> paramsType = Class.forName("android.companion.virtual.VirtualDeviceParams");
        Object paramsBuilder = Class.forName(paramsType.getName() + "$Builder").getConstructor().newInstance();
        call(paramsBuilder, "setName", new Class<?>[]{String.class}, "二维码桥接原型");
        call(paramsBuilder, "setDevicePolicy", new Class<?>[]{int.class, int.class},
                constant(paramsType, "POLICY_TYPE_CAMERA"), constant(paramsType, "DEVICE_POLICY_CUSTOM"));
        call(paramsBuilder, "setDevicePolicy", new Class<?>[]{int.class, int.class},
                constant(paramsType, "POLICY_TYPE_ACTIVITY"), constant(paramsType, "DEVICE_POLICY_DEFAULT"));
        device = call(manager, "createVirtualDevice", new Class<?>[]{int.class, paramsType}, association, build(paramsBuilder));
        observeActivities();
        Class<?> callbackType = Class.forName("android.companion.virtual.camera.VirtualCameraCallback");
        Object callback = Proxy.newProxyInstance(callbackType.getClassLoader(), new Class<?>[]{callbackType}, (proxy, method, args) -> {
            switch (method.getName()) {
                case "onStreamConfigured":
                    System.out.println("STREAM " + Arrays.toString(args));
                    streams.put((Integer) args[0], (Surface) args[1]);
                    draw((Integer) args[0],null);
                    break;
                case "onProcessCaptureRequest": draw((Integer) args[0],((Number) args[1]).longValue()); break;
                case "onStreamClosed": streams.remove((Integer) args[0]); break;
                case "hashCode": return System.identityHashCode(proxy);
                case "equals": return proxy == args[0];
                case "toString": return "二维码桥接相机回调";
            }
            return null;
        });
        Object cameraBuilder = Class.forName("android.companion.virtual.camera.VirtualCameraConfig$Builder")
                .getConstructor(String.class).newInstance("二维码桥接后置相机");
        call(cameraBuilder, "setLensFacing", new Class<?>[]{int.class}, 1);
        call(cameraBuilder, "setSensorOrientation", new Class<?>[]{int.class}, 0);
        call(cameraBuilder, "addStreamConfig", new Class<?>[]{int.class,int.class,int.class,int.class}, 640,480,PixelFormat.RGBA_8888,30);
        call(cameraBuilder, "setVirtualCameraCallback", new Class<?>[]{Executor.class,callbackType}, (Executor) Runnable::run, callback);
        Object config = build(cameraBuilder);
        camera = call(device, "createVirtualCamera", new Class<?>[]{config.getClass()}, config);
        reader = ImageReader.newInstance(720, 1280, PixelFormat.RGBA_8888, 3);
        HandlerThread captureThread = new HandlerThread("qrbridge-capture");
        captureThread.start();
        reader.setOnImageAvailableListener(r -> {
            try (Image image = r.acquireLatestImage()) {
                if (image == null) return;
                Image.Plane plane = image.getPlanes()[0];
                int width = plane.getRowStride() / plane.getPixelStride();
                Bitmap padded = Bitmap.createBitmap(width, image.getHeight(), Bitmap.Config.ARGB_8888);
                padded.copyPixelsFromBuffer(plane.getBuffer());
                screen = Bitmap.createBitmap(padded, 0, 0, image.getWidth(), image.getHeight());
            }
        }, new Handler(captureThread.getLooper()));
        VirtualDisplayConfig displayConfig = new VirtualDisplayConfig.Builder("二维码桥接屏幕",720,1280,240)
                .setSurface(reader.getSurface()).setFlags(displayFlags()).build();
        display = (VirtualDisplay) call(device, "createVirtualDisplay",
                new Class<?>[]{VirtualDisplayConfig.class,Executor.class,VirtualDisplay.Callback.class}, displayConfig,null,null);
        displayId = display.getDisplay().getDisplayId();
    }

    static JSONObject status() throws Exception {
        Class<?> infoType = Class.forName("android.view.DisplayInfo");
        Object info = infoType.getConstructor().newInstance();
        call(display.getDisplay(),"getDisplayInfo",new Class<?>[]{infoType},info);
        return new JSONObject().put("pid", android.os.Process.myPid()).put("display_id", displayId)
                .put("display_mode",displayMode).put("display_group_id",infoType.getField("displayGroupId").getInt(info))
                .put("display_flags",display.getDisplay().getFlags())
                .put("device_id", call(device,"getDeviceId",new Class<?>[0]))
                .put("persistent_device_id", call(device,"getPersistentDeviceId",new Class<?>[0]))
                .put("camera_id",call(camera,"getId",new Class<?>[0]))
                .put("streams",streams.size()).put("image_loaded",frame != null);
    }

    static JSONObject cameraPermission(String packageName, boolean grant) throws Exception {
        String permission = "android.permission.CAMERA";
        String persistentId = (String) call(device,"getPersistentDeviceId",new Class<?>[0]);
        Object binder = Class.forName("android.os.ServiceManager")
                .getMethod("getService",String.class).invoke(null,"permissionmgr");
        Object manager = Class.forName("android.permission.IPermissionManager$Stub")
                .getMethod("asInterface",android.os.IBinder.class).invoke(null,binder);
        Class<?>[] signature = {String.class,String.class,String.class,int.class};
        System.out.println("PERMISSION_SIGNATURE " + manager.getClass().getMethod("grantRuntimePermission",signature));
        int before = (Integer) call(manager,"checkPermission",signature,packageName,permission,persistentId,0);
        if (grant) call(manager,"grantRuntimePermission",signature,packageName,permission,persistentId,0);
        int after = (Integer) call(manager,"checkPermission",signature,packageName,permission,persistentId,0);
        return new JSONObject().put("package",packageName).put("permission",permission)
                .put("persistent_device_id",persistentId).put("user_id",0)
                .put("before",before).put("after",after)
                .put("granted",after == 0);
    }

    static UiAutomation ui() throws Exception {
        if (automation == null) {
            uiThread = new HandlerThread("qrbridge-ui");
            uiThread.start();
            Object connection = Class.forName("android.app.UiAutomationConnection").getConstructor().newInstance();
            automation = UiAutomation.class.getConstructor(Looper.class,Class.forName("android.app.IUiAutomationConnection"))
                    .newInstance(uiThread.getLooper(),connection);
            call(automation,"connect",new Class<?>[]{int.class},UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);
            AccessibilityServiceInfo info = automation.getServiceInfo();
            info.flags |= AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS | AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS;
            automation.setServiceInfo(info);
        }
        return automation;
    }

    static JSONObject node(AccessibilityNodeInfo item) throws Exception {
        Rect bounds = new Rect();
        item.getBoundsInScreen(bounds);
        JSONArray children = new JSONArray();
        for (int i = 0; i < item.getChildCount(); i++) {
            AccessibilityNodeInfo child = item.getChild(i);
            if (child != null) children.put(node(child));
        }
        return new JSONObject().put("text",String.valueOf(item.getText()))
                .put("description",String.valueOf(item.getContentDescription()))
                .put("id",String.valueOf(item.getViewIdResourceName()))
                .put("class",String.valueOf(item.getClassName())).put("bounds",bounds.flattenToString())
                .put("clickable",item.isClickable()).put("children",children);
    }

    static JSONObject command(JSONObject request) throws Exception {
        switch (request.getString("command")) {
            case "status": return status();
            case "capture-frame": return captureFrame();
            case "camera-permission": return cameraPermission(request.getString("package"),false);
            case "grant-camera": return cameraPermission(request.getString("package"),true);
            case "image":
                byte[] bytes = Base64.decode(request.getString("data"),Base64.DEFAULT);
                frame = android.graphics.BitmapFactory.decodeByteArray(bytes,0,bytes.length);
                if (frame == null) throw new IllegalArgumentException("无法解码图片");
                return status();
            case "screenshot":
                Bitmap shot = screen;
                if (shot == null) throw new IllegalStateException("虚拟屏幕尚无画面");
                ByteArrayOutputStream png = new ByteArrayOutputStream();
                shot.compress(Bitmap.CompressFormat.PNG,100,png);
                return new JSONObject().put("display_id",displayId).put("data",Base64.encodeToString(png.toByteArray(),Base64.NO_WRAP));
            case "tree":
                JSONArray windows = new JSONArray();
                List<AccessibilityWindowInfo> list = ui().getWindowsOnAllDisplays().get(displayId);
                if (list != null) for (AccessibilityWindowInfo window : list) {
                    AccessibilityNodeInfo root = window.getRoot();
                    if (root != null) windows.put(node(root));
                }
                return new JSONObject().put("display_id",displayId).put("windows",windows);
            case "stop": return new JSONObject().put("stopping",true);
            default: throw new IllegalArgumentException(request.toString());
        }
    }

    public static void main(String[] args) throws Exception {
        Looper.prepareMainLooper();
        displayMode = args[1];
        create(Integer.parseInt(args[0]));
        try (LocalServerSocket server = new LocalServerSocket("android_qr_bridge")) {
            System.out.println("READY " + status());
            while (true) {
                try (LocalSocket socket = server.accept()) {
                    JSONObject request = new JSONObject(new BufferedReader(new InputStreamReader(socket.getInputStream())).readLine());
                    JSONObject response;
                    try { response = command(request); }
                    catch (Exception error) {
                        error.printStackTrace();
                        StringWriter trace = new StringWriter();
                        error.printStackTrace(new PrintWriter(trace));
                        response = new JSONObject().put("error",trace.toString());
                    }
                    socket.getOutputStream().write((response + "\n").getBytes("UTF-8"));
                    if (request.getString("command").equals("stop")) break;
                }
            }
        } finally {
            if (automation != null) call(automation,"disconnect",new Class<?>[0]);
            display.release();
            call(camera,"close",new Class<?>[0]);
            call(device,"close",new Class<?>[0]);
            reader.close();
        }
        System.exit(0);
    }
}
