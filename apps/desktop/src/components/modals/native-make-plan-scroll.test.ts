import { it, expect } from 'vitest';
import { centeredPlanScroll, planWheelDelta, attachPlanWheel } from './native-make-plan-scroll';
it('centres a middle step in the scroll viewport', () =>
  expect(centeredPlanScroll(500, 80, 400, 1000)).toBe(340));
it('clamps first/last steps and non-overflowing plans to the real scroll bounds', () => {
  expect(centeredPlanScroll(0, 80, 400, 1000)).toBe(0);
  expect(centeredPlanScroll(920, 80, 400, 1000)).toBe(600);
  expect(centeredPlanScroll(200, 80, 400, 300)).toBe(0);
});
it('translates vertical wheel and preserves the dominant horizontal trackpad gesture', () => {
  expect(planWheelDelta(0, 100, 0, 400)).toBe(100);
  expect(planWheelDelta(-60, 10, 0, 400)).toBe(-60);
  expect(planWheelDelta(2, -30, 0, 400)).toBe(-30);
});
it('normalizes line and page wheel units', () => {
  expect(planWheelDelta(0, 3, 1, 400)).toBe(48);
  expect(planWheelDelta(0, -1, 2, 400)).toBe(-400);
});
class Port extends EventTarget {
  clientWidth = 400;
  scrollWidth = 1000;
  scrollLeft = 0;
}
function wheel(port: Port, y: number, ctrlKey = false) {
  const e = new Event('wheel', { bubbles: true, cancelable: true });
  Object.defineProperties(e, {
    deltaX: { value: 0 },
    deltaY: { value: y },
    deltaMode: { value: 0 },
    ctrlKey: { value: ctrlKey },
  });
  port.dispatchEvent(e);
  return e;
}
it('confines wheel scrolling to the plan and clamps both ends', () => {
  const p = new Port(),
    off = attachPlanWheel(p as unknown as HTMLElement);
  expect(wheel(p, 200).defaultPrevented).toBe(true);
  expect(p.scrollLeft).toBe(200);
  wheel(p, 10000);
  expect(p.scrollLeft).toBe(600);
  expect(wheel(p, 100).defaultPrevented).toBe(true);
  wheel(p, -10000);
  expect(p.scrollLeft).toBe(0);
  off();
  wheel(p, 100);
  expect(p.scrollLeft).toBe(0);
});
it('does not intercept zoom gestures or wheel when no overflow exists', () => {
  const p = new Port(),
    off = attachPlanWheel(p as unknown as HTMLElement);
  expect(wheel(p, 200, true).defaultPrevented).toBe(false);
  expect(p.scrollLeft).toBe(0);
  p.scrollWidth = 300;
  expect(wheel(p, 200).defaultPrevented).toBe(false);
  off();
});
