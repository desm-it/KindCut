import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JoyRuntimeClient } from './joy-runtime-client';

const fixture = `const rl=require('node:readline').createInterface({input:process.stdin});
rl.on('line',line=>{let q=JSON.parse(line);if(q.op==='stall')return;
if(q.op==='bad'){process.stdout.write('NOT-JSON-DO-NOT-ECHO\\n');return;}
let r=JSON.stringify({id:q.id,ok:true,result:{protocol:1,hardwareAccess:false}})+'\\n';
process.stdout.write(r.slice(0,4));setTimeout(()=>process.stdout.write(r.slice(4)),5);
});`;
async function testClient(run: (client: JoyRuntimeClient) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kindcut-joy-client-'));
  const script = path.join(dir, 'peer.cjs');
  await fs.writeFile(script, fixture);
  const client = new JoyRuntimeClient({ executable: process.execPath, args: [script] });
  try {
    await run(client);
  } finally {
    await client.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}
describe('native Joy runtime subprocess boundary', () => {
  it('allows cooperative worker cleanup after EOF and waits for actual process exit', async () => {
    const code = `const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',s=>{const q=JSON.parse(s);process.stdout.write(JSON.stringify({id:q.id,ok:true,result:{}})+'\\n');});rl.on('close',()=>setTimeout(()=>process.exit(0),800));`;
    const client = new JoyRuntimeClient({ executable: process.execPath, args: ['-e', code] });
    try {
      await client.request({ op: 'probe' });
      const child = (
        client as unknown as { child: { exitCode: number | null; signalCode: string | null } }
      ).child;
      const first = client.close();
      await client.close();
      expect(child.exitCode).toBe(0);
      expect(child.signalCode).toBeNull();
      await first;
    } finally {
      await client.close();
    }
  });
  it('constructs without spawning', async () =>
    testClient(async (client) => {
      expect(client.isRunning).toBe(false);
    }));
  it('reassembles fragmented replies from a real inert subprocess', async () =>
    testClient(async (client) => {
      const result = await client.request({ op: 'probe' });
      expect(result).toEqual({ protocol: 1, hardwareAccess: false });
    }));
  it('times out and never silently restarts', async () =>
    testClient(async (client) => {
      await expect(client.request({ op: 'stall' }, 40)).rejects.toThrow(/deadline/i);
      expect(client.isRunning).toBe(false);
      await expect(client.request({ op: 'probe' })).rejects.toThrow(/closed/i);
    }));
  it('does not include raw stdout in protocol errors', async () =>
    testClient(async (client) => {
      let error: unknown;
      try {
        await client.request({ op: 'bad' });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain('DO-NOT-ECHO');
      expect(client.isRunning).toBe(false);
    }));
  it('does not send overlapping requests', async () =>
    testClient(async (client) => {
      const pending = client.request({ op: 'stall' }, 50);
      await expect(client.request({ op: 'probe' })).rejects.toThrow(/busy/i);
      await expect(pending).rejects.toThrow(/deadline/i);
    }));
  it('can synchronously abort its owned process on app shutdown', async () =>
    testClient(async (client) => {
      await client.request({ op: 'probe' });
      client.abort();
      expect(client.isRunning).toBe(false);
      await expect(client.request({ op: 'probe' })).rejects.toThrow(/closed/i);
    }));
});
