import XCTest

/// XCTestCase entry point.
/// Starts the TCP JSON-RPC server and blocks indefinitely.
/// The test never "completes" — the server stays running until the process is killed.
class XCTestServerRunner: XCTestCase {

    func testStartServer() throws {
        let port: UInt16 = 45679
        NSLog("[XCTestServer] Starting TCP server on port \(port)")

        let server = TCPServer(port: port)
        server.start()

        NSLog("[XCTestServer] Server running on port \(port)")

        // Block indefinitely
        let semaphore = DispatchSemaphore(value: 0)
        semaphore.wait()
    }
}
