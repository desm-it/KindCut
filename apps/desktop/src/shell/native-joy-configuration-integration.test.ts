import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { JoyRuntimeClient } from './joy-runtime-client';
import { NativeJoyService } from './native-joy-service';
import { JoyConfigurationStore } from './joy-configuration-store';
import { JoyConfigurationService } from './joy-configuration-service';
import { buildWorkspaceCutSvg, type WorkspaceObject } from '../workspace-objects';
import { normalizeWorkspaceSvgForJoy } from '../native-joy-workspace-normalize';
import { nativeWorkspaceStrokeTools } from '../native-joy-workspace-source';
const workspaceSource = (tool: 'pen' | 'fine_point_blade') => {
  const object: WorkspaceObject = {
    id: 'actual-workspace-test',
    type: 'path',
    kind: 'shape',
    sourceKind: 'shape',
    fileName: 'Synthetic geometry',
    fileSize: '1KB',
    sizeCopy: '40px',
    frame: { width: 40, height: 40 },
    paths: [
      {
        id: 'p',
        d: 'M0 0 H40 V40 Z',
        fill: tool === 'pen' ? 'none' : '#112233',
        stroke: '#112233',
        strokeWidth: '1.5',
      },
    ],
    transform: { x: 80, y: 80, scaleX: 1, scaleY: 1, rotation: 0 },
  };
  const mat = { widthIn: 4.5, heightIn: 12 },
    tools = [{ color: '#112233', type: tool === 'pen' ? ('pen' as const) : ('cut' as const) }];
  const svg = normalizeWorkspaceSvgForJoy(
    buildWorkspaceCutSvg([object], 360, 960, tools, 80, '', {
      x: 0,
      y: 0,
      width: 360,
      height: 960,
    }),
    mat,
  );
  return {
    svg,
    materialId: 1,
    mat,
    strokeTools: nativeWorkspaceStrokeTools(svg, { '112233': tool }),
  };
};

describe('actual persisted app settings to Python configured compiler', () => {
  it('imports, validates, persists, reloads and compiles a real SVG without any hardware request', async () => {
    const root = path.resolve(process.cwd(), '../..'),
      python = path.join(root, 'packages/joy-runtime/.venv/bin/python'),
      worker = path.join(root, 'packages/joy-runtime/runtime/worker.py');
    const fixture = JSON.parse(
      await fs.readFile(
        path.join(root, 'apps/desktop/native-tests/configuration.synthetic.json'),
        'utf8',
      ),
    );
    const folder = await fs.mkdtemp(
      path.join(process.env.TMPDIR ?? os.tmpdir(), 'joy-config-integration-'),
    );
    const commands: string[] = [];
    const native = new NativeJoyService({
      platform: 'darwin',
      enabled: true,
      runtimePath: python,
      store: {
        exists: async () => false,
        save: async () => {},
        load: async () => {
          throw new Error('unused');
        },
      },
      clientFactory: () => {
        const client = new JoyRuntimeClient({ executable: python, args: [worker, '--stdio'] });
        return {
          get isRunning() {
            return client.isRunning;
          },
          close: () => client.close(),
          request: (r: Record<string, unknown>, timeout?: number) => {
            commands.push(String(r.op));
            return client.request(r, timeout);
          },
        };
      },
    });
    try {
      const file = path.join(folder, 'library.json'),
        store = new JoyConfigurationStore(file);
      const api = new JoyConfigurationService({
        store,
        offline: (r) => native.runOfflineConfiguration(r),
        capture: async () => {
          throw new Error('No hardware capture allowed');
        },
      });
      const profileId = fixture.settings.profileId;
      await api.importLibrary({
        schemaVersion: 1,
        kind: 'kindcut_joy_configuration_library',
        profiles: [
          {
            id: profileId,
            name: 'SYNTHETIC TEST ONLY',
            provenance: 'synthetic_test',
            settings: fixture.settings,
          },
          {
            id: 'synthetic-blade',
            name: 'SYNTHETIC BLADE TEST ONLY',
            provenance: 'synthetic_test',
            settings: {
              ...fixture.settings,
              profileId: 'synthetic-blade',
              tool: 'fine_point_blade',
              operation: 'cut',
            },
          },
        ],
        calibrations: [
          {
            id: 'test-calibration',
            capturedAt: '2026-01-01T00:00:00.000Z',
            deviceFingerprint: 'a'.repeat(64),
            firmwareSelector: 8.164000001,
            source: 'imported_unverified',
            physicalCalibrationVerified: false,
            pressureResponsesHex: fixture.rows,
          },
        ],
        selection: null,
      });
      await api.select({ profileId, calibrationId: 'test-calibration' });
      expect((await new JoyConfigurationStore(file).load()).selection?.profileId).toBe(profileId);
      const result = await api.compile({
        profileId,
        calibrationId: 'test-calibration',
        source: workspaceSource('pen'),
      });
      expect(result.execution).toBe('unsupported');
      expect(result.candidate.configurationBodyTemplates).toHaveLength(3);
      expect(result.candidate.configurationValidated).toBe(false);
      expect(result.candidate.safetyValidated).toBe(false);
      expect(
        Buffer.from(
          (result.candidate.configurationBodyTemplates as Array<{ bodyHex: string }>)[0]!.bodyHex,
          'hex',
        )[10],
      ).toBe(2);
      const blade = await api.compile({
        profileId: 'synthetic-blade',
        calibrationId: 'test-calibration',
        source: workspaceSource('fine_point_blade'),
      });
      expect(blade.candidate.configurationBodyTemplates).toHaveLength(3);
      const machine = Buffer.from(
        (blade.candidate.configurationBodyTemplates as Array<{ bodyHex: string }>)[0]!.bodyHex,
        'hex',
      );
      expect(machine[1]).toBe(8);
      expect(machine[10]).toBe(0);
      expect(blade.candidate.configurationValidated).toBe(false);
      expect(commands).toEqual([
        'configuration',
        'configuration',
        'configuration',
        'configuration',
      ]);
      expect(native.ownsHardware).toBe(false);
    } finally {
      await native.disconnect();
      await fs.rm(folder, { recursive: true, force: true });
    }
  }, 15000);
});
