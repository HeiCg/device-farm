/**
 * Device API client functions.
 */
import { apiFetch } from './client.js';
import type { Device, DeviceMetadata } from './types.js';

/**
 * List all devices from the server.
 */
export async function listDevices(): Promise<Device[]> {
	return apiFetch<Device[]>('/devices');
}

/**
 * Restart a device by ID.
 */
export async function restartDevice(id: string): Promise<{ status: string }> {
	return apiFetch<{ status: string }>(`/devices/${id}/restart`, { method: 'POST' });
}

/**
 * Fetch detailed device info including metadata.
 */
export async function fetchDeviceInfo(
	id: string
): Promise<{ device: Device; metadata: DeviceMetadata | null }> {
	return apiFetch<{ device: Device; metadata: DeviceMetadata | null }>(
		`/devices/${id}/info`
	);
}

/**
 * Refresh device metadata by re-collecting from the device.
 */
export async function refreshDeviceInfo(
	id: string
): Promise<{ deviceId: string; metadata: DeviceMetadata }> {
	return apiFetch<{ deviceId: string; metadata: DeviceMetadata }>(
		`/devices/${id}/info/refresh`,
		{ method: 'POST' }
	);
}
