// glass-feed <window x,y,w,h> <region dx,dy,w,h> [fps]
// Streams the screen under `region` (points, relative to the given window frame's top-left), with the window itself
// excluded, as 4-byte big-endian length + JPEG frames on stdout. Exits when stdin closes.
// The region follows the window's bottom edge, which stays put while the card grows or shrinks its window upward.
import CoreImage
import Foundation
import ScreenCaptureKit

func rect(_ text: String) -> CGRect {
  let v = text.split(separator: ",").map { Double($0)! }
  return CGRect(x: v[0], y: v[1], width: v[2], height: v[3])
}

func windows(_ option: CGWindowListOption, _ id: CGWindowID) -> [(CGWindowID, CGRect)] {
  let list = CGWindowListCopyWindowInfo(option, id) as! [[String: Any]]
  return list.map { info in
    (info[kCGWindowNumber as String] as! CGWindowID,
     CGRect(dictionaryRepresentation: info[kCGWindowBounds as String] as! CFDictionary)!)
  }
}

final class Feed: NSObject, SCStreamOutput {
  let window: CGWindowID, frame: CGRect, region: CGRect, display: CGRect
  let context = CIContext()
  let out = FileHandle.standardOutput

  init(window: CGWindowID, frame: CGRect, region: CGRect, display: CGRect) {
    self.window = window; self.frame = frame; self.region = region; self.display = display
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
    guard let pixels = buffer.imageBuffer, let bounds = windows(.optionIncludingWindow, window).first?.1 else { return }
    let image = CIImage(cvPixelBuffer: pixels)
    let scale = image.extent.width / display.width
    let top = (bounds.maxY - frame.height + region.minY - display.minY) * scale
    // The camera frame is 4:3, wider than the glass: take the desktop either side, centred on the glass so the
    // phone sees what the glass shows; past the screen edge it is white.
    let h = region.height * scale, w = h * 4 / 3
    let x = (bounds.minX + region.midX - display.minX) * scale - w / 2
    // Core Image puts the origin at the bottom-left.
    let crop = CGRect(x: x, y: image.extent.height - top - h, width: w, height: h)
    let fit = min(640 / w, 480 / h)
    let scaled = image.cropped(to: crop).composited(over: CIImage(color: .white).cropped(to: crop))
      .transformed(by: CGAffineTransform(translationX: -crop.minX, y: -crop.minY).scaledBy(x: fit, y: fit))
    guard let jpeg = context.jpegRepresentation(of: scaled, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
      options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.7]) else { return }
    var length = UInt32(jpeg.count).bigEndian
    out.write(Data(bytes: &length, count: 4))
    out.write(jpeg)
  }
}

let args = CommandLine.arguments
let frame = rect(args[1]), region = rect(args[2])
let fps = args.count > 3 ? Int32(args[3])! : 12
signal(SIGPIPE, SIG_DFL)
Thread.detachNewThread {
  _ = FileHandle.standardInput.readDataToEndOfFile()
  exit(0)
}

let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
guard let id = windows(.optionOnScreenOnly, kCGNullWindowID)
  .first(where: { abs($0.1.minX - frame.minX) < 2 && abs($0.1.minY - frame.minY) < 2
    && abs($0.1.width - frame.width) < 2 && abs($0.1.height - frame.height) < 2 })?.0,
  let own = content.windows.first(where: { $0.windowID == id }),
  let display = content.displays.first(where: { $0.frame.intersects(frame) })
else {
  FileHandle.standardError.write("没有找到卡片小窗或它所在的屏幕\n".data(using: .utf8)!)
  exit(1)
}
let config = SCStreamConfiguration()
config.width = Int(display.frame.width) * 2
config.height = Int(display.frame.height) * 2
config.minimumFrameInterval = CMTime(value: 1, timescale: fps)
config.pixelFormat = kCVPixelFormatType_32BGRA
config.showsCursor = false
let feed = Feed(window: id, frame: frame, region: region, display: display.frame)
let stream = SCStream(filter: SCContentFilter(display: display, excludingWindows: [own]), configuration: config, delegate: nil)
try stream.addStreamOutput(feed, type: .screen, sampleHandlerQueue: DispatchQueue(label: "glass-feed"))
try await stream.startCapture()
FileHandle.standardError.write("FEEDING window \(id)\n".data(using: .utf8)!)
while true { try await Task.sleep(for: .seconds(3600)) }
