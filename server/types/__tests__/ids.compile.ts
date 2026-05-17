// This file is never imported at runtime. It proves TS rejects misuse of branded IDs.
// If `tsc --noEmit` fails, the brand protection is broken.
import type { JobId, DeviceId } from '../ids.js';

declare function consumeJobId(id: JobId): void;
declare function consumeDeviceId(id: DeviceId): void;

const a: JobId    = 'abc' as JobId;
const b: DeviceId = 'xyz' as DeviceId;

consumeJobId(a);        // OK
consumeDeviceId(b);     // OK

// @ts-expect-error — DeviceId is not assignable to JobId
consumeJobId(b);

// @ts-expect-error — raw string is not assignable to DeviceId
consumeDeviceId('xyz');

// Positive negative: raw uuid string is not a JobId
const rawString: string = '550e8400-e29b-41d4-a716-446655440000';
// @ts-expect-error — string is not assignable to JobId
consumeJobId(rawString);
