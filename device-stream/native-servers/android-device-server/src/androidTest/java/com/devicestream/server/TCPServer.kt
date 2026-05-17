package com.devicestream.server

import android.util.Log
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.Executors

/**
 * TCP server accepting newline-delimited JSON-RPC 2.0 messages.
 * Mirrors the iOS TCPServer (Network.framework) pattern.
 *
 * Each line is a complete JSON-RPC request; response is a single JSON line + newline.
 * Supports multiple simultaneous connections.
 */
class TCPServer(
    private val port: Int,
    private val handler: JsonRpcHandler
) {
    companion object {
        private const val TAG = "TCPServer"
    }

    private var serverSocket: ServerSocket? = null
    private val executor = Executors.newCachedThreadPool()
    @Volatile private var running = false

    fun start() {
        running = true
        serverSocket = ServerSocket(port)
        Log.i(TAG, "Listening on port $port")

        executor.submit {
            while (running) {
                try {
                    val client = serverSocket?.accept() ?: break
                    Log.i(TAG, "New connection from ${client.remoteSocketAddress}")
                    executor.submit { handleConnection(client) }
                } catch (e: Exception) {
                    if (running) Log.e(TAG, "Accept error", e)
                }
            }
        }
    }

    fun stop() {
        running = false
        serverSocket?.close()
        executor.shutdownNow()
    }

    private fun handleConnection(socket: Socket) {
        try {
            val reader = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.UTF_8))
            val writer = OutputStreamWriter(socket.getOutputStream(), Charsets.UTF_8)

            var line: String?
            while (reader.readLine().also { line = it } != null) {
                val trimmed = line!!.trim()
                if (trimmed.isEmpty()) continue

                val response = handler.handle(trimmed)
                writer.write(response)
                writer.write("\n")
                writer.flush()
            }
        } catch (e: Exception) {
            if (running) Log.e(TAG, "Connection error", e)
        } finally {
            try { socket.close() } catch (_: Exception) {}
            Log.i(TAG, "Connection closed")
        }
    }
}
