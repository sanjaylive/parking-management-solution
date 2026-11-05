import { Injectable } from '@nestjs/common';
import { AdapterNotAvailableError, BarrierAdapter, DeviceRef, DisplayAdapter, HardwareTransport, PrinterAdapter } from './adapters';
import { SimulatorBarrier, SimulatorDisplay, SimulatorPrinter } from './simulator';

/**
 * In-process transport: resolves adapters by device.adapter key.
 * Only the simulator is bundled. Vendor adapters (e.g. 'zkteco-barrier', 'hikvision-anpr') live in
 * services/hardware-gateway and are reached through the gateway transport — PENDING: requires vendor SDKs/devices.
 */
@Injectable()
export class InProcessTransport implements HardwareTransport {
  private barriers: Record<string, BarrierAdapter> = { simulator: new SimulatorBarrier() };
  private printers: Record<string, PrinterAdapter> = { simulator: new SimulatorPrinter() };
  private displays: Record<string, DisplayAdapter> = { simulator: new SimulatorDisplay() };

  barrier(d: DeviceRef) {
    const a = this.barriers[d.adapter];
    if (!a) throw new AdapterNotAvailableError(`No barrier adapter '${d.adapter}' available in this process`);
    return a;
  }
  printer(d: DeviceRef) {
    const a = this.printers[d.adapter];
    if (!a) throw new AdapterNotAvailableError(`No printer adapter '${d.adapter}'`);
    return a;
  }
  display(d: DeviceRef) {
    const a = this.displays[d.adapter];
    if (!a) throw new AdapterNotAvailableError(`No display adapter '${d.adapter}'`);
    return a;
  }
}
