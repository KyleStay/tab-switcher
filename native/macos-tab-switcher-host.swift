#!/usr/bin/env swift

import ApplicationServices
import AppKit
import CoreGraphics
import Foundation

private let tabKeyCode: Int64 = 48
private let outputLock = NSLock()
private var switcherSessionActive = false
private let browserBundleIdentifiers: Set<String> = [
  "com.google.Chrome",
  "com.google.Chrome.canary"
]

func isBrowserFrontmost() -> Bool {
  guard let bundleIdentifier = NSWorkspace.shared.frontmostApplication?.bundleIdentifier else {
    return false
  }
  return browserBundleIdentifiers.contains(bundleIdentifier)
}

func writeMessage(_ message: [String: Any]) {
  guard JSONSerialization.isValidJSONObject(message),
        let data = try? JSONSerialization.data(withJSONObject: message) else {
    return
  }

  var length = UInt32(data.count).littleEndian
  let header = Data(bytes: &length, count: MemoryLayout<UInt32>.size)

  outputLock.lock()
  FileHandle.standardOutput.write(header)
  FileHandle.standardOutput.write(data)
  outputLock.unlock()
}

func readMessagesUntilDisconnect() {
  let input = FileHandle.standardInput

  while true {
    let header = input.readData(ofLength: MemoryLayout<UInt32>.size)
    if header.count == 0 {
      exit(0)
    }
    if header.count != MemoryLayout<UInt32>.size {
      exit(1)
    }

    let length = header.withUnsafeBytes { bytes in
      bytes.load(as: UInt32.self).littleEndian
    }
    if length == 0 {
      continue
    }

    let body = input.readData(ofLength: Int(length))
    if body.count != Int(length) {
      exit(1)
    }
  }
}

let callback: CGEventTapCallBack = { _, type, event, _ in
  if type == .flagsChanged {
    if switcherSessionActive && !event.flags.contains(.maskControl) {
      switcherSessionActive = false
      writeMessage(["type": "commit"])
    }
    return Unmanaged.passUnretained(event)
  }

  if type != .keyDown {
    return Unmanaged.passUnretained(event)
  }

  let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
  let flags = event.flags
  let isCtrlTab = keyCode == tabKeyCode
    && flags.contains(.maskControl)
    && !flags.contains(.maskCommand)
    && !flags.contains(.maskAlternate)

  guard isCtrlTab else {
    return Unmanaged.passUnretained(event)
  }
  guard isBrowserFrontmost() else {
    return Unmanaged.passUnretained(event)
  }

  let direction = flags.contains(.maskShift) ? -1 : 1
  switcherSessionActive = true
  writeMessage(["type": "cycle", "direction": direction])
  return nil
}

guard let eventTap = CGEvent.tapCreate(
  tap: .cgSessionEventTap,
  place: .headInsertEventTap,
  options: .defaultTap,
  eventsOfInterest: CGEventMask(1 << CGEventType.keyDown.rawValue)
    | CGEventMask(1 << CGEventType.flagsChanged.rawValue),
  callback: callback,
  userInfo: nil
) else {
  fputs("Tab Switcher native host could not create an event tap. Grant Accessibility permission to the installed native host binary.\n", stderr)
  exit(2)
}

DispatchQueue.global(qos: .utility).async {
  readMessagesUntilDisconnect()
}

let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
CGEvent.tapEnable(tap: eventTap, enable: true)
writeMessage(["type": "ready"])
CFRunLoopRun()
