import { BarrierAdapter, CommandResult, DeviceRef, DisplayAdapter, PrinterAdapter } from './adapters';

/**
 * Hardware simulator for development and automated tests.
 * Behaviour controlled per device via config.simulate: 'ok' | 'offline' | 'nack' | 'timeout' | 'flaky'.
 */
export type SimMode = 'ok' | 'offline' | 'nack' | 'timeout' | 'flaky';

export class SimulatorLog {
  static entries: { deviceId: string; action: string; at: Date; result: CommandResult }[] = [];
  static clear() {
    this.entries = [];
  }
}

const flakyCounter = new Map<string, number>();

async function simulate(device: DeviceRef, action: string): Promise<CommandResult> {
  const mode = (device.config?.simulate as SimMode) ?? 'ok';
  let result: CommandResult;
  switch (mode) {
    case 'offline':
      result = { ok: false, error: 'DEVICE_UNREACHABLE' };
      break;
    case 'nack':
      result = { ok: false, error: 'DEVICE_NACK' };
      break;
    case 'timeout':
      await new Promise((r) => setTimeout(r, Number(device.config?.timeoutMs ?? 5000)));
      result = { ok: false, error: 'DEVICE_TIMEOUT' };
      break;
    case 'flaky': {
      const n = (flakyCounter.get(device.id) ?? 0) + 1;
      flakyCounter.set(device.id, n);
      result = n % 2 === 1 ? { ok: false, error: 'DEVICE_NACK' } : { ok: true };
      break;
    }
    default:
      result = { ok: true };
  }
  SimulatorLog.entries.push({ deviceId: device.id, action, at: new Date(), result });
  return result;
}

export class SimulatorBarrier implements BarrierAdapter {
  open(d: DeviceRef) {
    return simulate(d, 'OPEN');
  }
  close(d: DeviceRef) {
    return simulate(d, 'CLOSE');
  }
}
export class SimulatorPrinter implements PrinterAdapter {
  printReceipt(d: DeviceRef) {
    return simulate(d, 'PRINT');
  }
}
export class SimulatorDisplay implements DisplayAdapter {
  showAvailability(d: DeviceRef) {
    return simulate(d, 'DISPLAY');
  }
}
