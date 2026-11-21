import type { JobPanelState } from './native-joy-job-controller';
export type MakeNext = {
  action: 'connect' | 'start' | 'go' | 'end' | 'resume' | 'prepare' | null;
  label: string;
  intent?: 'connect' | 'job-start' | 'job-go' | 'job-end' | 'job-resume';
  disabled: boolean;
};
export function penColourName(color: string | undefined, nl: boolean): string {
  const palette = [
    ['#2156a8', 'blue', 'blauwe'],
    ['#000000', 'black', 'zwarte'],
    ['#ffffff', 'white', 'witte'],
    ['#d72b35', 'red', 'rode'],
    ['#228b45', 'green', 'groene'],
    ['#8a45ae', 'purple', 'paarse'],
    ['#ed8b23', 'orange', 'oranje'],
    ['#f0d131', 'yellow', 'gele'],
    ['#de72a5', 'pink', 'roze'],
    ['#805332', 'brown', 'bruine'],
    ['#808080', 'grey', 'grijze'],
  ];
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return '';
  const rgb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const input = rgb(color);
  let best = palette[0]!,
    distance = Infinity;
  for (const entry of palette) {
    const d = rgb(entry[0]!).reduce((sum, v, i) => sum + (v - input[i]!) ** 2, 0);
    if (d < distance) {
      distance = d;
      best = entry;
    }
  }
  return best[nl ? 2 : 1]!;
}
export function makeNextAction(
  s: JobPanelState,
  connected: boolean,
  connectionBusy: boolean,
  language: string,
  fallbackPenColour?: string,
  allowConnectAfterCompleted = false,
): MakeNext {
  const nl = language === 'nl',
    wait = (label: string): MakeNext => ({ action: null, label, disabled: true });
  if (s.cancelPending) return wait(nl ? 'Stoppen…' : 'Stopping…');
  if (connectionBusy) return wait(nl ? 'Verbinden…' : 'Connecting…');
  const j = s.job,
    active = Boolean(j?.active && !j.historical);
  if (s.busy) return wait(nl ? 'Voorbereiden…' : 'Preparing…');
  if (j?.phase === 'completed' && !s.preview && !allowConnectAfterCompleted)
    return wait(nl ? 'Gereed' : 'Done');
  if (!connected && !active)
    return {
      action: 'connect',
      label: nl ? 'Verbinden' : 'Connect',
      intent: 'connect',
      disabled: false,
    };
  if (s.error && !active)
    return { action: 'prepare', label: nl ? 'Opnieuw proberen' : 'Try again', disabled: false };
  if (active && j?.phase === 'waiting_for_go') {
    const a = j.workflow?.actions[j.workflow.actionIndex],
      colour = penColourName(a?.color ?? fallbackPenColour, nl),
      cut = j.tool === 'fine_point_blade';
    return {
      action: 'go',
      label: cut
        ? nl
          ? 'Start snijden'
          : 'Start cutting'
        : nl
          ? `Start ${colour ? colour + ' ' : ''}pen`
          : `Start ${colour ? colour + ' ' : ''}pen`,
      intent: 'job-go',
      disabled: s.stale,
    };
  }
  if (active && j?.phase === 'retained_ready') {
    if (j.workflow && j.workflow.actionIndex + 1 < j.workflow.actionCount && !s.stale && !s.error)
      return wait(nl ? 'Volgende stap voorbereiden…' : 'Preparing next step…');
    return {
      action: 'end',
      label: nl ? 'Mat uitladen' : 'Unload mat',
      intent: 'job-end',
      disabled: s.endPending,
    };
  }
  if (active && j?.phase === 'paused')
    return {
      action: 'resume',
      label: nl ? 'Doorgaan' : 'Resume',
      intent: 'job-resume',
      disabled: s.stale || s.resumePending,
    };
  if (active)
    return wait(
      j?.phase === 'waiting_for_mat'
        ? nl
          ? 'Plaats de mat'
          : 'Insert mat'
        : nl
          ? 'Bezig…'
          : 'Working…',
    );
  if (s.preview && !s.stale)
    return {
      action: 'start',
      label: nl ? 'Mat laden' : 'Load mat',
      intent: 'job-start',
      disabled: false,
    };
  return wait(nl ? 'Voorbereiden…' : 'Preparing…');
}
