import com.google.zxing.BarcodeFormat;
import com.google.zxing.qrcode.QRCodeWriter;
import com.google.zxing.common.BitMatrix;
import java.awt.image.BufferedImage;
import java.io.File;
import javax.imageio.ImageIO;

public class QrImage {
    public static void main(String[] args) throws Exception {
        BitMatrix bits = new QRCodeWriter().encode(args[0],BarcodeFormat.QR_CODE,360,360);
        BufferedImage image = new BufferedImage(360,360,BufferedImage.TYPE_INT_RGB);
        for (int y = 0; y < 360; y++) for (int x = 0; x < 360; x++) image.setRGB(x,y,bits.get(x,y) ? 0 : 0xffffff);
        ImageIO.write(image,"png",new File(args[1]));
    }
}
