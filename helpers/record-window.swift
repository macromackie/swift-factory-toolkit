import AVFoundation
import AppKit
import Foundation
import ScreenCaptureKit

final class RecordingDelegate: NSObject, SCRecordingOutputDelegate, @unchecked Sendable {
  private let lock = NSLock()
  private var result: Result<Void, Error>?

  var completion: Result<Void, Error>? { lock.withLock { result } }

  func recordingOutputDidStartRecording(_ recordingOutput: SCRecordingOutput) {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    print("Recording started at \(formatter.string(from: Date()))")
    fflush(stdout)
  }

  func recordingOutput(_ recordingOutput: SCRecordingOutput, didFailWithError error: Error) {
    lock.withLock { result = .failure(error) }
  }

  func recordingOutputDidFinishRecording(_ recordingOutput: SCRecordingOutput) {
    lock.withLock {
      if result == nil { result = .success(()) }
    }
  }
}

@main
struct RecordWindow {
  static func failure(_ message: String) -> NSError {
    NSError(
      domain: "SwiftFactoryRecording", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }

  @MainActor
  static func main() async throws {
    let arguments = CommandLine.arguments
    guard (3...5).contains(arguments.count) else {
      throw failure(
        "Usage: record-window output.mp4 stop-file [maximum-seconds] [application-bundle-id]")
    }
    let maximumSeconds = arguments.count >= 4 ? Int(arguments[3]) : 1200
    let applicationBundleID = arguments.count == 5 ? arguments[4] : "com.apple.ScreenContinuity"
    guard let maximumSeconds, (1...1200).contains(maximumSeconds) else {
      throw failure("Maximum seconds must be an integer from 1 to 1200")
    }
    let destination = URL(fileURLWithPath: arguments[1]).standardizedFileURL
    let stop = URL(fileURLWithPath: arguments[2]).standardizedFileURL
    let files = FileManager.default
    guard destination.pathExtension.lowercased() == "mp4", destination != stop else {
      throw failure("Use an MP4 output and a separate stop-file path")
    }
    guard !files.fileExists(atPath: destination.path), !files.fileExists(atPath: stop.path) else {
      throw failure("Choose unused output and stop-file paths")
    }
    _ = NSApplication.shared
    let content = try await SCShareableContent.excludingDesktopWindows(
      true, onScreenWindowsOnly: true)
    let windows = content.windows.filter {
      $0.owningApplication?.bundleIdentifier == applicationBundleID
        && $0.frame.width > 0 && $0.frame.height > 0
    }
    guard windows.count == 1, let window = windows.first else {
      throw failure("Expected exactly one visible window for \(applicationBundleID)")
    }
    let filter = SCContentFilter(desktopIndependentWindow: window)
    let configuration = SCStreamConfiguration()
    let scale = CGFloat(filter.pointPixelScale)
    configuration.width = Int(filter.contentRect.width * scale) / 2 * 2
    configuration.height = Int(filter.contentRect.height * scale) / 2 * 2
    configuration.minimumFrameInterval = CMTime(value: 1, timescale: 30)
    configuration.capturesAudio = false
    configuration.captureMicrophone = false
    configuration.showsCursor = false
    configuration.ignoreShadowsSingleWindow = true

    let staging = destination.deletingLastPathComponent()
      .appendingPathComponent(".capture-\(UUID().uuidString)", isDirectory: true)
    try files.createDirectory(at: staging, withIntermediateDirectories: false)
    let captured = staging.appendingPathComponent(destination.lastPathComponent)
    do {
      let delegate = RecordingDelegate()
      let outputConfiguration = SCRecordingOutputConfiguration()
      outputConfiguration.outputURL = captured
      outputConfiguration.videoCodecType = .h264
      outputConfiguration.outputFileType = .mp4
      let output = SCRecordingOutput(configuration: outputConfiguration, delegate: delegate)
      let stream = SCStream(filter: filter, configuration: configuration, delegate: nil)
      try stream.addRecordingOutput(output)
      try await stream.startCapture()
      let deadline = ContinuousClock.now.advanced(by: .seconds(maximumSeconds))
      while ContinuousClock.now < deadline && !files.fileExists(atPath: stop.path)
        && delegate.completion == nil
      {
        try await Task.sleep(for: .milliseconds(250))
      }
      try await stream.stopCapture()
      let finishDeadline = ContinuousClock.now.advanced(by: .seconds(15))
      while delegate.completion == nil && ContinuousClock.now < finishDeadline {
        try await Task.sleep(for: .milliseconds(100))
      }
      guard let completion = delegate.completion else {
        throw failure("Recording did not finish saving within 15 seconds")
      }
      try completion.get()
      // Publishing only the finished file also refuses a destination created during capture.
      try files.moveItem(at: captured, to: destination)
      try files.removeItem(at: staging)
      print("Recording saved: \(destination.path)")
    } catch {
      fputs("Capture retained for inspection: \(staging.path)\n", stderr)
      throw error
    }
  }
}
