import Foundation
import Network

/// TCP server using Network.framework (NWListener).
/// Accepts newline-delimited JSON-RPC 2.0 messages on the configured port.
/// Supports multiple simultaneous connections.
class TCPServer {
    private let port: UInt16
    private var listener: NWListener?
    private let handler = JsonRpcHandler()
    private var connections = [NWConnection]()
    private let queue = DispatchQueue(label: "com.devicestream.xctest.server", attributes: .concurrent)

    init(port: UInt16) {
        self.port = port
    }

    func start() {
        do {
            let params = NWParameters.tcp
            params.allowLocalEndpointReuse = true

            listener = try NWListener(using: params, on: NWEndpoint.Port(rawValue: port)!)
        } catch {
            NSLog("[TCPServer] Failed to create listener: \(error)")
            return
        }

        listener?.stateUpdateHandler = { state in
            switch state {
            case .ready:
                NSLog("[TCPServer] Listening on port \(self.port)")
            case .failed(let error):
                NSLog("[TCPServer] Listener failed: \(error)")
            default:
                break
            }
        }

        listener?.newConnectionHandler = { [weak self] connection in
            self?.handleConnection(connection)
        }

        listener?.start(queue: queue)
    }

    func stop() {
        listener?.cancel()
        for conn in connections {
            conn.cancel()
        }
        connections.removeAll()
    }

    private func handleConnection(_ connection: NWConnection) {
        NSLog("[TCPServer] New connection")
        connections.append(connection)

        connection.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                NSLog("[TCPServer] Connection ready")
                self?.receiveLoop(connection)
            case .failed(let error):
                NSLog("[TCPServer] Connection failed: \(error)")
                self?.removeConnection(connection)
            case .cancelled:
                self?.removeConnection(connection)
            default:
                break
            }
        }

        connection.start(queue: queue)
    }

    private func receiveLoop(_ connection: NWConnection) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
            if let data = data, !data.isEmpty {
                self?.processData(data, connection: connection)
            }

            if isComplete {
                connection.cancel()
                return
            }

            if let error = error {
                NSLog("[TCPServer] Receive error: \(error)")
                connection.cancel()
                return
            }

            // Continue receiving
            self?.receiveLoop(connection)
        }
    }

    // Per-connection buffer for partial messages
    private var buffers = [ObjectIdentifier: String]()
    private let bufferLock = NSLock()

    private func processData(_ data: Data, connection: NWConnection) {
        let connId = ObjectIdentifier(connection)
        let text = String(data: data, encoding: .utf8) ?? ""

        bufferLock.lock()
        var buffer = buffers[connId, default: ""]
        buffer += text
        buffers[connId] = buffer
        bufferLock.unlock()

        // Process complete lines
        while true {
            bufferLock.lock()
            guard var buf = buffers[connId], let newlineRange = buf.range(of: "\n") else {
                bufferLock.unlock()
                break
            }
            let line = String(buf[buf.startIndex..<newlineRange.lowerBound])
            buf = String(buf[newlineRange.upperBound...])
            buffers[connId] = buf
            bufferLock.unlock()

            if line.trimmingCharacters(in: .whitespaces).isEmpty { continue }

            let response = handler.handle(line)
            let responseData = (response + "\n").data(using: .utf8)!
            connection.send(content: responseData, completion: .contentProcessed { error in
                if let error = error {
                    NSLog("[TCPServer] Send error: \(error)")
                }
            })
        }
    }

    private func removeConnection(_ connection: NWConnection) {
        let connId = ObjectIdentifier(connection)
        bufferLock.lock()
        buffers.removeValue(forKey: connId)
        bufferLock.unlock()
        connections.removeAll { $0 === connection }
    }
}
