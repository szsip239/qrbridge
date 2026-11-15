package local.qrbridge.probe;

import android.app.Activity;
import android.app.ActivityOptions;
import android.content.Intent;
import android.graphics.SurfaceTexture;
import android.hardware.Camera;
import android.hardware.camera2.*;
import android.media.Image;
import android.media.ImageReader;
import android.os.*;
import android.view.*;
import android.widget.*;
import com.google.zxing.*;
import com.google.zxing.common.HybridBinarizer;
import java.nio.ByteBuffer;
import java.util.*;

public class ProbeActivity extends Activity implements TextureView.SurfaceTextureListener {
    public static final class SingleInstance extends ProbeActivity {}
    public static final class NewTask extends ProbeActivity {}
    public static final class PortraitTask extends ProbeActivity {}
    public static final class Unresizable extends ProbeActivity {}
    TextureView preview;
    TextView result;
    TextView count;
    CameraDevice camera2;
    CameraCaptureSession session;
    Camera camera1;
    ImageReader reader;
    Handler handler;
    String api = "Camera2";
    int clicks;
    String decoded = "";
    boolean requestOnly;
    final Object frameLock = new Object();

    public void onCreate(Bundle state) {
        super.onCreate(state);
        requestOnly = getIntent().getBooleanExtra("request_camera",false);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        HandlerThread worker = new HandlerThread("probe-camera");
        worker.start();
        handler = new Handler(worker.getLooper());
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        TextView title = new TextView(this);
        title.setText(getClass().getSimpleName() + " display=" + getDisplay().getDisplayId()
                + " device=" + getDeviceId() + " task=" + getTaskId());
        title.setTextSize(22);
        root.addView(title);
        LinearLayout controls = new LinearLayout(this);
        for (String name : new String[]{"Camera2", "Camera1"}) {
            Button button = new Button(this);
            button.setText(name);
            button.setOnClickListener(v -> { closeCamera(); api = name; decoded = ""; openCamera(); });
            controls.addView(button);
        }
        Button tap = new Button(this);
        tap.setText("点击计数");
        tap.setOnClickListener(v -> count.setText("点击次数：" + ++clicks));
        controls.addView(tap);
        root.addView(controls);
        count = new TextView(this);
        count.setText("点击次数：0");
        root.addView(count);
        if (getClass() == ProbeActivity.class) {
            addLaunch(root,"singleInstance",SingleInstance.class,0,false);
            addLaunch(root,"NEW_TASK",NewTask.class,Intent.FLAG_ACTIVITY_NEW_TASK,false);
            addLaunch(root,"singleTask 竖屏",PortraitTask.class,0,false);
            addLaunch(root,"不可缩放竖屏",Unresizable.class,Intent.FLAG_ACTIVITY_NEW_TASK,false);
            addLaunch(root,"显式 display 0",NewTask.class,Intent.FLAG_ACTIVITY_NEW_TASK,true);
        }
        result = new TextView(this);
        result.setText("等待相机");
        root.addView(result);
        preview = new TextureView(this);
        preview.setSurfaceTextureListener(this);
        root.addView(preview,new LinearLayout.LayoutParams(-1,0,1));
        setContentView(root);
        if (requestOnly) preview.post(() -> requestPermissions(new String[]{android.Manifest.permission.CAMERA},100));
    }

    void addLaunch(LinearLayout root, String label, Class<?> target, int flags, boolean physical) {
        Button button = new Button(this);
        button.setText(label);
        button.setOnClickListener(v -> {
            Intent intent = new Intent(this,target).addFlags(flags);
            if (physical) {
                startActivity(intent,ActivityOptions.makeBasic().setLaunchDisplayId(0).toBundle());
            } else {
                startActivity(intent);
            }
        });
        root.addView(button);
    }

    void show(String value) { runOnUiThread(() -> result.setText(value)); }

    void decode(byte[] bytes, int width, int height) {
        if (!decoded.isEmpty()) return;
        try {
            PlanarYUVLuminanceSource source = new PlanarYUVLuminanceSource(bytes,width,height,0,0,width,height,false);
            Result qr = new MultiFormatReader().decode(new BinaryBitmap(new HybridBinarizer(source)));
            decoded = qr.getText();
            show(api + " 已解码：" + decoded);
        } catch (NotFoundException ignored) {
            // 二维码尚未进入完整取景帧，继续读真实相机帧。
        }
    }

    void openCamera() {
        try {
            SurfaceTexture texture = preview.getSurfaceTexture();
            texture.setDefaultBufferSize(640,480);
            if (api.equals("Camera1")) {
                int number = Camera.getNumberOfCameras();
                show("Camera1 可见相机数：" + number);
                int selected = -1;
                for (int i = 0; i < number; i++) {
                    Camera.CameraInfo info = new Camera.CameraInfo();
                    Camera.getCameraInfo(i,info);
                    if (info.facing == Camera.CameraInfo.CAMERA_FACING_BACK) { selected = i; break; }
                }
                if (selected == -1) throw new IllegalStateException("Camera1 无后置相机");
                camera1 = Camera.open(selected);
                Camera.Parameters parameters = camera1.getParameters();
                parameters.setPreviewSize(640,480);
                parameters.setPreviewFormat(android.graphics.ImageFormat.NV21);
                camera1.setParameters(parameters);
                camera1.setPreviewTexture(texture);
                camera1.setPreviewCallback((bytes,camera) -> decode(bytes,640,480));
                camera1.startPreview();
                return;
            }
            CameraManager manager = getSystemService(CameraManager.class);
            String[] ids = manager.getCameraIdList();
            show("Camera2 可见：" + Arrays.toString(ids));
            String id = null;
            for (String candidate : ids) {
                if (manager.getCameraCharacteristics(candidate).get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK) {
                    id = candidate;
                    break;
                }
            }
            if (id == null) throw new IllegalStateException("Camera2 无后置相机");
            reader = ImageReader.newInstance(640,480,android.graphics.ImageFormat.YUV_420_888,3);
            reader.setOnImageAvailableListener(r -> {
                synchronized (frameLock) {
                  try (Image image = r.acquireLatestImage()) {
                    if (image == null) return;
                    Image.Plane plane = image.getPlanes()[0];
                    ByteBuffer buffer = plane.getBuffer();
                    byte[] bytes = new byte[image.getWidth()*image.getHeight()];
                    for (int y = 0; y < image.getHeight(); y++) {
                        for (int x = 0; x < image.getWidth(); x++) {
                            bytes[y*image.getWidth()+x] = buffer.get(y*plane.getRowStride()+x*plane.getPixelStride());
                        }
                    }
                    decode(bytes,image.getWidth(),image.getHeight());
                  }
                }
            },handler);
            manager.openCamera(id,new CameraDevice.StateCallback() {
                public void onOpened(CameraDevice camera) {
                    camera2 = camera;
                    try {
                        Surface view = new Surface(texture);
                        List<Surface> outputs = Arrays.asList(view,reader.getSurface());
                        camera.createCaptureSession(outputs,new CameraCaptureSession.StateCallback() {
                            public void onConfigured(CameraCaptureSession capture) {
                                session = capture;
                                try {
                                    CaptureRequest.Builder request = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
                                    for (Surface surface : outputs) request.addTarget(surface);
                                    session.setRepeatingRequest(request.build(),null,handler);
                                } catch (Exception error) { throw new RuntimeException(error); }
                            }
                            public void onConfigureFailed(CameraCaptureSession capture) { throw new IllegalStateException("Camera2 配置失败"); }
                        },handler);
                    } catch (Exception error) { throw new RuntimeException(error); }
                }
                public void onDisconnected(CameraDevice camera) { show("Camera2 已断开"); camera.close(); }
                public void onError(CameraDevice camera,int error) { throw new IllegalStateException("Camera2 错误：" + error); }
            },handler);
        } catch (Exception error) { throw new RuntimeException(error); }
    }

    void closeCamera() {
        if (camera1 != null) { camera1.setPreviewCallback(null); camera1.release(); camera1 = null; }
        if (session != null) { session.close(); session = null; }
        if (camera2 != null) { camera2.close(); camera2 = null; }
        synchronized (frameLock) {
            if (reader != null) { reader.setOnImageAvailableListener(null,null); reader.close(); reader = null; }
        }
    }
    public void onSurfaceTextureAvailable(SurfaceTexture texture,int width,int height) { if (!requestOnly) openCamera(); }
    public boolean onSurfaceTextureDestroyed(SurfaceTexture texture) { closeCamera(); return true; }
    public void onSurfaceTextureSizeChanged(SurfaceTexture texture,int width,int height) {}
    public void onSurfaceTextureUpdated(SurfaceTexture texture) {}
    protected void onPause() { closeCamera(); super.onPause(); }
    protected void onResume() { super.onResume(); if (!requestOnly && preview != null && preview.isAvailable()) openCamera(); }
}
