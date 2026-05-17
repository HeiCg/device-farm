package com.devicestream.server

import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch

/**
 * Instrumentation test entry point.
 * Starts the TCP JSON-RPC server and blocks indefinitely.
 *
 * Deploy & run:
 *   ./gradlew assembleDebug assembleDebugAndroidTest
 *   adb install -t app/build/outputs/apk/debug/app-debug.apk
 *   adb install -t app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
 *   adb shell am instrument -w -r com.devicestream.server.test/androidx.test.runner.AndroidJUnitRunner
 *   adb forward tcp:9008 tcp:9008
 *
 * Connect via TCP:
 *   echo '{"jsonrpc":"2.0","method":"ping","id":1}' | nc localhost 9008
 */
@RunWith(AndroidJUnit4::class)
class DeviceServerTest {

    companion object {
        private const val TAG = "DeviceServer"
        private const val DEFAULT_PORT = 9008
    }

    @Test
    fun startServer() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val uiDevice = UiDevice.getInstance(instrumentation)
        val uiAutomation = instrumentation.uiAutomation

        val port = InstrumentationRegistry.getArguments()
            .getString("port")?.toIntOrNull() ?: DEFAULT_PORT

        Log.i(TAG, "Starting TCP JSON-RPC server on port $port")

        val handler = JsonRpcHandler(uiDevice, uiAutomation, instrumentation)
        val server = TCPServer(port, handler)
        server.start()

        Log.i(TAG, "Server running on port $port")

        // Block indefinitely
        val latch = CountDownLatch(1)
        Runtime.getRuntime().addShutdownHook(Thread {
            Log.i(TAG, "Shutting down...")
            server.stop()
            latch.countDown()
        })

        try {
            latch.await()
        } catch (_: InterruptedException) {
            Log.i(TAG, "Interrupted, shutting down...")
            server.stop()
        }
    }
}
