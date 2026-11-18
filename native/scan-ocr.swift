import Foundation
import ImageIO
import Vision

do {
    guard CommandLine.arguments.count == 2 else {
        throw NSError(domain: "scan-ocr", code: 1, userInfo: [NSLocalizedDescriptionKey: "用法：scan-ocr 图片.png"])
    }
    let url = URL(fileURLWithPath: CommandLine.arguments[1])
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw NSError(domain: "scan-ocr", code: 1, userInfo: [NSLocalizedDescriptionKey: "OCR 无法读取图片"])
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
    request.usesLanguageCorrection = false
    try VNImageRequestHandler(cgImage: image).perform([request])
    let width = Double(image.width), height = Double(image.height)
    let observations: [[String: Any]] = (request.results ?? []).compactMap { observation in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let box = observation.boundingBox
        // Vision uses a bottom-left origin; Android input uses a top-left origin.
        return ["text": candidate.string, "confidence": candidate.confidence,
                "bounds": [box.minX * width, (1 - box.maxY) * height,
                           box.maxX * width, (1 - box.minY) * height]]
    }
    let data = try JSONSerialization.data(withJSONObject: ["width": image.width, "height": image.height,
                                                          "observations": observations], options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
} catch {
    FileHandle.standardError.write(Data("OCR 失败：\(error.localizedDescription)\n".utf8))
    exit(1)
}
