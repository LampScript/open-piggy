// Read only the matching Fliggy page in the default browser's visible tabs.
import AppKit
import ApplicationServices

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data(message.utf8))
    exit(1)
}
guard CommandLine.arguments.count >= 2, let expected = URLComponents(string: CommandLine.arguments[1]) else {
    fail("Missing itinerary URL.")
}
guard AXIsProcessTrusted() else { fail("需要终端的 macOS 辅助功能权限才能读取网页。") }
guard let appURL = NSWorkspace.shared.urlForApplication(toOpen: expected.url!),
      let bundle = Bundle(url: appURL)?.bundleIdentifier,
      let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundle).first else {
    fail("请在默认浏览器中打开飞猪行程。")
}
func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    AXUIElementCopyAttributeValue(element, name as CFString, &value)
    return value
}
func children(_ element: AXUIElement) -> [AXUIElement] {
    attribute(element, "AXChildren") as? [AXUIElement] ?? []
}
func matches(_ url: URL) -> Bool {
    guard let current = URLComponents(url: url, resolvingAgainstBaseURL: false),
          current.scheme == "https", current.host == expected.host, current.path == expected.path else { return false }
    return (expected.queryItems ?? []).allSatisfy { current.queryItems?.contains($0) == true }
}
var choices: [(String, AXUIElement)] = []
func text(_ element: AXUIElement, _ lines: inout [String]) {
    let role = attribute(element, "AXRole") as? String
    if role == "AXTextField" || role == "AXTextArea" || role == "AXSecureTextField" { return }
    if role == "AXButton", let label = (attribute(element, "AXTitle") as? String) ?? (attribute(element, "AXDescription") as? String),
       label == "选为去程" || label == "选为返程" {
        choices.append((label, element))
        lines.append(label)
        return
    }
    if role == "AXStaticText" {
        if let value = attribute(element, "AXValue") as? String { lines.append(value) }
    } else {
        for child in children(element) { text(child, &lines) }
    }
}
func flightArea(_ element: AXUIElement) -> AXUIElement? {
    if attribute(element, "AXRole") as? String == "AXWebArea" {
        guard let url = attribute(element, "AXURL") as? URL, matches(url) else { return nil }
        return element
    }
    for child in children(element) { if let area = flightArea(child) { return area } }
    return nil
}
let browser = AXUIElementCreateApplication(app.processIdentifier)
_ = AXUIElementSetAttributeValue(browser, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
for window in attribute(browser, "AXWindows") as? [AXUIElement] ?? [] {
    if let area = flightArea(window) {
        var lines: [String] = []
        text(area, &lines)
        if CommandLine.arguments.count == 4 {
            let matching = choices.filter { $0.0 == CommandLine.arguments[2] }
            guard let index = Int(CommandLine.arguments[3]), index > 0, index <= matching.count else {
                fail("当前页面没有对应的航班选项。")
            }
            guard AXUIElementPerformAction(matching[index - 1].1, kAXPressAction as CFString) == .success else {
                fail("无法选择该行程，请在网页中选择。")
            }
        } else {
            print(lines.joined(separator: "\n"))
        }
        exit(0)
    }
}
fail("请将对应日期的飞猪行程标签页切到前台。")
