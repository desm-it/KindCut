import { it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NativeJoyService } from './native-joy-service';
import { JoyRuntimeClient } from './joy-runtime-client';

// Actual Python worker/service/retained loader against the existing inert peer.
// This test deliberately replaces only connection creation, never compiler or
// loading responses. There is no real transport, Bluetooth, discovery or helper.
const runtime = fileURLToPath(new URL('../../../../packages/joy-runtime/', import.meta.url));
const program = `
import sys
sys.path[:0]=sys.argv[1:3]
import worker
from test_joy_measurement_experiment import Session, Clock
from test_joy_retained_composition import LoaderPeer
class Fixture(worker.RuntimeService):
 def _handle_owned(self, request):
  if request.get('op')=='connect':
   if self.session is not None: raise RuntimeError('already owned')
   c=Clock();s=Session();s.channel=LoaderPeer(c)
   self.session=s;self._loading_clock=c;self._loading_sleep=c.sleep
   self._summary=dict(state='ready',machine='cricut_joy',firmwareSelector=s.result.selector,
       materialRecord=0,fallbackUsed=False,status=dict(status_byte_1=96,status_byte_2=1,
       extra_u16_raw=0,extra_u16_native=0,value_be32=0))
   return dict(self._summary)
  return super()._handle_owned(request)
worker.serve(sys.stdin.buffer,sys.stdout,Fixture(platform='darwin'))
`;
function service() {
  return new NativeJoyService({
    platform: 'darwin',
    enabled: true,
    runtimePath: '/never-executed-fixture',
    store: {
      exists: async () => false,
      save: async () => {},
      load: async () => {
        throw Error('not used');
      },
    },
    clientFactory: () =>
      new JoyRuntimeClient({
        executable: path.join(runtime, '.venv/bin/python'),
        args: ['-u', '-c', program, path.join(runtime, 'runtime'), path.join(runtime, 'tests')],
      }),
  });
}
async function waiting(s: NativeJoyService) {
  const end = Date.now() + 4000;
  while (Date.now() < end) {
    const r = await s.loadingStatus();
    if (r.phase === 'waiting_for_go') return r;
    if (!r.active) throw Error('inert loading unexpectedly ended');
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error('inert loading did not reach host wait');
}
it('actual Node service and stdio worker retain alignment through Go, then retire without a job', async () => {
  const s = service();
  try {
    await s.connect({
      address: '00:11:22:33:44:55',
      hardwareApproved: true,
      cryptoResetApproved: true,
    });
    const r = await s.startLoading(12, true, true);
    expect(r.phase).toBe('loading_and_aligning');
    expect((await waiting(s)).physicalAlignmentVerified).toBe(false);
    await expect(s.pollStatus()).rejects.toThrow(/loading/i);
    await s.controlLoading('go');
    let done = await s.loadingStatus();
    const end = Date.now() + 4000;
    while (done.active && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 10));
      done = await s.loadingStatus();
    }
    expect(done.phase).toBe('completed');
    expect(done.sessionRetired).toBe(true);
    expect(done.jobStarted).toBe(false);
    expect(s.ownsHardware).toBe(false);
  } finally {
    await s.disconnect();
  }
}, 10000);
it('actual Node disconnect signals worker cancel and observes clean task retirement', async () => {
  const s = service();
  try {
    await s.connect({
      address: '00:11:22:33:44:55',
      hardwareApproved: true,
      cryptoResetApproved: true,
    });
    await s.startLoading(6.5, true, true);
    await waiting(s);
    await s.disconnect();
    const done = await s.loadingStatus();
    expect(done.phase).toBe('cancelled');
    expect(done.active).toBe(false);
    expect(done.sessionRetired).toBe(true);
    expect(done.motionStoppedVerified).toBe(false);
    expect(s.ownsHardware).toBe(false);
  } finally {
    await s.disconnect();
  }
}, 10000);
