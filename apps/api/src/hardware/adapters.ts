/**
 * Hardware adapter contracts. Vendors differ wildly (HTTP, TCP, RS-485/Modbus, MQTT, vendor SDKs), so the
 * API never talks protocol — it emits commands; an adapter (in-process for simulator, or inside the
 * hardware-gateway service near the devices) translates them and acknowledges.
 */
export interface DeviceRef {
  id: string;
  adapter: string;
  config: Record<string, unknown>;
}

export interface CommandResult {
  ok: boolean;
  error?: string;
}

export interface BarrierAdapter {
  open(device: DeviceRef, opts: { commandId: string; holdSeconds?: number }): Promise<CommandResult>;
  close(device: DeviceRef, opts: { commandId: string }): Promise<CommandResult>;
}

export interface PrinterAdapter {
  printReceipt(device: DeviceRef, doc: { lines: string[]; qr?: string }): Promise<CommandResult>;
}

export interface DisplayAdapter {
  showAvailability(device: DeviceRef, data: { text: string; available: number }): Promise<CommandResult>;
}

/** Inbound-only device kinds (ANPR, sensors, scanners) push signed events to /v1/devices/events. */
export interface AnprEvent {
  eventId: string;
  direction: 'ENTRY' | 'EXIT';
  plate: string;
  confidence: number;
  imageKey?: string;
  occurredAt: string;
}

export interface HardwareTransport {
  barrier(device: DeviceRef): BarrierAdapter;
  printer(device: DeviceRef): PrinterAdapter;
  display(device: DeviceRef): DisplayAdapter;
}

export class AdapterNotAvailableError extends Error {}
