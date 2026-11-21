/** Plain IPC data only. No native transport, credentials or execution authority. */
export type NativeConfigurationTool = 'pen' | 'fine_point_blade';
export interface NativeConfigurationSource {
  svg: string;
  materialId: number;
  mat: { widthIn: number; heightIn: number; mode?: 'card' };
  strokeTools: Record<string, { tool: NativeConfigurationTool; operation: 'draw' | 'cut' }>;
}
export interface NativeConfigurationProfileSummary {
  id: string;
  name: string;
  materialId: number;
  tool: NativeConfigurationTool;
  mode: 'precision';
  pressureRequest: number;
  provenance: string;
  passCount?: number;
  pressureRequests?: number[];
  sourceMaterialId?: number;
  workspaceMaterialName?: string;
}
export interface NativeMaterialPresetSummary {
  id: string;
  name: string;
  sourceMaterialId: number;
  tool: 'pen' | 'fine_point_blade';
  mode: 'precision';
  passCount: number;
  pressureRequests: number[];
  provenance: string;
}
export interface NativeCalibrationSummary {
  id: string;
  capturedAt: string;
  firmwareSelector: number;
  source: string;
  physicalCalibrationVerified: false;
}
export interface NativeConfigurationCatalog {
  profiles: NativeConfigurationProfileSummary[];
  calibrations: NativeCalibrationSummary[];
  selection: { profileId: string; calibrationId: string } | null;
  materials?: NativeMaterialPresetSummary[];
}
export interface NativeConfigurationCompileResult {
  candidate: Record<string, unknown>;
  passes?: Array<{
    passNumber: number;
    pressureRequest: number;
    candidate: Record<string, unknown>;
  }>;
  execution: 'unsupported';
  physicalCalibrationVerified: false;
}
export interface NativeJoyConfigurationApi {
  configurationList(): Promise<NativeConfigurationCatalog>;
  configurationAdopt(input: {
    catalogId: string;
    materialId: number;
    materialName: string;
    confirmed: true;
  }): Promise<NativeConfigurationCatalog>;
  configurationImport(): Promise<NativeConfigurationCatalog | { canceled: true }>;
  configurationExport(): Promise<{ canceled: boolean }>;
  configurationSelect(input: {
    profileId: string;
    calibrationId: string;
  }): Promise<NativeConfigurationCatalog>;
  configurationCapture(): Promise<NativeConfigurationCatalog | { canceled: true }>;
  configurationUpdate(input: {
    profileId: string;
    pressureRequest: number;
  }): Promise<NativeConfigurationCatalog>;
  configurationCompile(input: {
    profileId: string;
    calibrationId: string;
    source: NativeConfigurationSource;
  }): Promise<NativeConfigurationCompileResult>;
}
