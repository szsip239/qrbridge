package local.qrbridge;

import android.content.Context;
import android.hardware.camera2.CameraManager;
import android.os.Looper;
import org.json.JSONArray;
import org.json.JSONObject;

public final class CameraInventory {
    public static void main(String[] args) throws Exception {
        Looper.prepareMainLooper();
        Context context = BridgeHost.shellContext();
        Context virtual = context.createDeviceContext(Integer.parseInt(args[0]));
        JSONObject result = new JSONObject()
                .put("default_device_id",context.getDeviceId())
                .put("default_cameras",new JSONArray(context.getSystemService(CameraManager.class).getCameraIdList()))
                .put("virtual_device_id",virtual.getDeviceId())
                .put("virtual_cameras",new JSONArray(virtual.getSystemService(CameraManager.class).getCameraIdList()));
        System.out.println(result);
        System.exit(0);
    }
}
