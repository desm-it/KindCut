/** Observation only. Never a checkpoint, transport handle or resume authority. */
export interface NativeJobRecoveryInfo {
  status: 'interrupted' | 'completed' | 'cancelled' | 'failed';
  reportId: string;
  operationId: number | null;
  lastKnownPhase: string;
  jobStarted: boolean;
  acceptedRecords: number;
  completedPasses: number;
  totalRecords: number;
  totalPasses: number;
  captureComplete: boolean;
  machineState: 'unknown';
  canResume: false;
  requiresFreshApproval: true;
}
