// Flat mobile launcher assets. Keep the glyph aligned with assets/Ramu.icon/Assets.
// iOS uses that layered Icon Composer source directly; Android masks these layers.
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let output = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("assets")
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
let rgb = CGColorSpaceCreateDeviceRGB()
func color(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat) -> CGColor {
  CGColor(colorSpace: rgb, components: [r / 255, g / 255, b / 255, 1])!
}
func render(_ name: String, opaque: Bool, monochrome: Bool = false, light: Bool = false) {
  let context = CGContext(data: nil, width: 1024, height: 1024, bitsPerComponent: 8, bytesPerRow: 0, space: rgb, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  context.translateBy(x: 0, y: 1024)
  context.scaleBy(x: 1, y: -1)
  if opaque {
    context.setFillColor(color(35, 35, 39))
    context.fill(CGRect(x: 0, y: 0, width: 1024, height: 1024))
  }
  context.setStrokeColor(light ? color(35, 35, 39) : color(245, 245, 247))
  context.setLineWidth(120)
  context.setLineCap(.round)
  context.move(to: CGPoint(x: 356, y: 694))
  context.addLine(to: CGPoint(x: 356, y: 518))
  context.addCurve(to: CGPoint(x: 548, y: 334), control1: CGPoint(x: 356, y: 402), control2: CGPoint(x: 434, y: 334))
  context.strokePath()
  context.setFillColor(monochrome ? color(245, 245, 247) : color(125, 108, 255))
  context.fillEllipse(in: CGRect(x: 592, y: 550, width: 144, height: 144))
  let destination = CGImageDestinationCreateWithURL(output.appendingPathComponent(name).appendingPathExtension("png") as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(destination, context.makeImage()!, nil)
  precondition(CGImageDestinationFinalize(destination))
}
render("icon", opaque: true)
render("icon-foreground", opaque: false)
render("icon-monochrome", opaque: false, monochrome: true)

render("splash-light", opaque: false, light: true)
