/**
 * Phase 24 / Plan 24-03 — Maestro bus subscribers.
 *
 * Cross-module subscriber: device.booted handler.
 * Receives the bus event from poolModule.bus, drives DeviceInfoCollector,
 * mutates Device.metadata, re-emits maestro.device-info.collected.
 *
 * Module factory wires the subscription via fastify.addHook('onReady', ...)
 * per Pitfall 2 (Phase 23 inheritance).
 */
import type { FastifyInstance } from 'fastify';
import type pino from 'pino';
import type { DeviceInfoCollector } from './device-info-collector.js';
import type { MaestroEmitters } from '../events.js';

export interface DeviceBootedHandlerDeps {
  fastify: FastifyInstance;
  deviceInfoCollector: DeviceInfoCollector;
  emit: MaestroEmitters;
  logger: pino.Logger;
}

/**
 * Build the async device.booted handler. Pure factory — no side effects
 * until the returned handler is invoked by the bus.
 *
 * Handler contract:
 *   1. Coerce raw payload to {deviceId, platform, emulatorId, port}.
 *   2. Await deviceInfoCollector.collect(platform, emulatorId, port).
 *   3. Mutate fastify.pool.getDeviceMap().get(deviceId).metadata = result.
 *   4. emit.deviceInfoCollected(deviceId, {deviceId, osVersion, model}).
 *   5. Catch any error — log warn — DO NOT re-throw (Phase 21 invariant:
 *      subscriber failures must not propagate to the bus).
 */
export function makeDeviceBootedHandler(deps: DeviceBootedHandlerDeps) {
  const { fastify, deviceInfoCollector, emit, logger } = deps;
  return async (raw: unknown): Promise<void> => {
    const payload = raw as {
      deviceId: string;
      platform: 'android' | 'ios';
      emulatorId: string;
      port: number | null;
    };
    try {
      const metadata = await deviceInfoCollector.collect(
        payload.platform,
        payload.emulatorId,
        payload.port,
      );
      const rawDevice = fastify.pool.getDeviceMap().get(payload.deviceId);
      if (rawDevice) rawDevice.metadata = metadata;
      emit.deviceInfoCollected(payload.deviceId, {
        deviceId: payload.deviceId,
        osVersion: metadata.osVersion,
        model: metadata.model,
      });
    } catch (err) {
      logger.warn(
        { err, deviceId: payload.deviceId },
        'collect failed on device.booted',
      );
      // DO NOT re-throw — subscriber failures must not propagate (Phase 21 invariant)
    }
  };
}
