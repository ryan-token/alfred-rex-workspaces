// Draws icon.png. Run with: swift icon/make-icon.swift
//
// The icon is generated rather than hand-drawn so the geometry stays exact and the
// artwork can be re-rendered at any size without a binary editor in the loop.
//
// It borrows Rex's look rather than its mascot: a soft light bezel, the warm-to-violet
// gradient, and the deep indigo of its eye, applied to a stack of workspace cards.

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let size = 512.0
let scale = size / 1024.0

func px(_ value: Double) -> Double { value * scale }

func rgb(_ hex: UInt32, _ alpha: Double = 1) -> CGColor {
    CGColor(
        red: Double((hex >> 16) & 0xFF) / 255,
        green: Double((hex >> 8) & 0xFF) / 255,
        blue: Double(hex & 0xFF) / 255,
        alpha: alpha
    )
}

// Sampled from Rex's own icon.
enum Palette {
    static let bezelTop = rgb(0xFFF4FF)
    static let bezelBottom = rgb(0xE2E6EB)
    static let gradient = [0xFFC100, 0xFF8A1F, 0xFF5F4F, 0xD268F0, 0xA391FF].map { rgb($0) }
    static let ink = rgb(0x1E0054)
    static let shadow = rgb(0x5B2A9E, 0.35)
}

let space = CGColorSpace(name: CGColorSpace.sRGB)!
let context = CGContext(
    data: nil,
    width: Int(size),
    height: Int(size),
    bitsPerComponent: 8,
    bytesPerRow: 0,
    space: space,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
)!

context.setAllowsAntialiasing(true)
context.interpolationQuality = .high

func roundedRect(_ rect: CGRect, _ radius: Double) -> CGPath {
    CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)
}

func gradient(_ colors: [CGColor]) -> CGGradient {
    let stops = colors.indices.map { CGFloat($0) / CGFloat(colors.count - 1) }
    return CGGradient(colorsSpace: space, colors: colors as CFArray, locations: stops)!
}

func fill(_ path: CGPath, with colors: [CGColor], from start: CGPoint, to end: CGPoint) {
    context.saveGState()
    context.addPath(path)
    context.clip()
    context.drawLinearGradient(gradient(colors), start: start, end: end, options: [])
    context.restoreGState()
}

// Bezel: Apple's continuous-corner ratio, so it sits correctly beside real app icons.
let bezel = CGRect(x: 0, y: 0, width: size, height: size)
let bezelPath = roundedRect(bezel, size * 0.2237)
fill(
    bezelPath,
    with: [Palette.bezelTop, Palette.bezelBottom],
    from: CGPoint(x: bezel.midX, y: bezel.maxY),
    to: CGPoint(x: bezel.midX, y: bezel.minY)
)

// Three workspace cards, each offset up and to the right of the one in front of it.
let step = px(78)
// Placed so the whole stack, front card plus two steps, is centred on the bezel.
let front = CGRect(x: px(154), y: px(174), width: px(560), height: px(520))
let cardRadius = px(96)
let backCards = [2, 1].map { depth in
    front.offsetBy(dx: step * Double(depth), dy: step * Double(depth))
}

// Back cards: pale tints of the gradient, so the stack reads as more of the same.
let backTints = [rgb(0xE9DDFF), rgb(0xFFD9E4)]
for (card, tint) in zip(backCards, backTints) {
    let path = roundedRect(card, cardRadius)
    context.saveGState()
    context.setShadow(offset: CGSize(width: 0, height: -px(10)), blur: px(36), color: Palette.shadow)
    context.addPath(path)
    context.setFillColor(tint)
    context.fillPath()
    context.restoreGState()
    context.addPath(path)
    context.setStrokeColor(rgb(0xFFFFFF, 0.9))
    context.setLineWidth(px(8))
    context.strokePath()
}

// Front card: Rex's gradient, warm at the top right and cooling to violet.
let frontPath = roundedRect(front, cardRadius)
context.saveGState()
context.setShadow(offset: CGSize(width: 0, height: -px(18)), blur: px(48), color: Palette.shadow)
context.addPath(frontPath)
// A gradient draws no shadow, so a solid fill casts it and the gradient covers it.
context.setFillColor(Palette.gradient[2])
context.fillPath()
context.restoreGState()
fill(
    frontPath,
    with: Palette.gradient,
    from: CGPoint(x: front.maxX, y: front.maxY),
    to: CGPoint(x: front.minX, y: front.minY)
)

// A soft gloss across the top, like the light catching Rex's own artwork.
fill(
    frontPath,
    with: [rgb(0xFFFFFF, 0.45), rgb(0xFFFFFF, 0)],
    from: CGPoint(x: front.midX, y: front.maxY),
    to: CGPoint(x: front.midX, y: front.midY)
)

// Prompt mark: chevron plus cursor in the indigo of Rex's eye, sized to stay legible
// when the icon is 32pt.
let markHeight = px(190)
let cursorWidth = px(120)
let markWidth = markHeight * 0.78 + cursorWidth
let markX = front.midX - markWidth / 2
let markY = front.midY - px(10)

context.setStrokeColor(Palette.ink)
context.setLineWidth(px(42))
context.setLineCap(.round)
context.setLineJoin(.round)
context.beginPath()
context.move(to: CGPoint(x: markX, y: markY + markHeight / 2))
context.addLine(to: CGPoint(x: markX + markHeight * 0.52, y: markY))
context.addLine(to: CGPoint(x: markX, y: markY - markHeight / 2))
context.strokePath()

let cursor = CGRect(
    x: markX + markHeight * 0.78,
    y: markY - markHeight / 2 - px(21),
    width: cursorWidth,
    height: px(42)
)
context.addPath(roundedRect(cursor, px(21)))
context.setFillColor(Palette.ink)
context.fillPath()

let output = URL(fileURLWithPath: "icon.png")
let destination = CGImageDestinationCreateWithURL(
    output as CFURL, UTType.png.identifier as CFString, 1, nil
)!
CGImageDestinationAddImage(destination, context.makeImage()!, nil)
guard CGImageDestinationFinalize(destination) else {
    FileHandle.standardError.write(Data("failed to write \(output.path)\n".utf8))
    exit(1)
}
print("wrote \(output.path) at \(Int(size))×\(Int(size))")
